import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingClient } from '../clients/pricing.client';
import { BillingClient } from '../clients/billing.client';
import { generateTradeId, generateIdempotencyKey, roundToDecimals } from '@solar-grid/shared-utils';

export interface MatchResult {
  matched: number;
  failed: number;
  skipped: number;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingClient: PricingClient,
    private readonly billingClient: BillingClient,
  ) {}

  async runMatching(correlationId: string): Promise<MatchResult> {
    const result: MatchResult = { matched: 0, failed: 0, skipped: 0 };

    // FIFO: oldest first
    const openSellers = await this.prisma.sellOffer.findMany({
      where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } },
      orderBy: { createdAt: 'asc' },
    });

    const openBuyers = await this.prisma.buyRequest.findMany({
      where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } },
      orderBy: { createdAt: 'asc' },
    });

    if (openSellers.length === 0 || openBuyers.length === 0) {
      this.logger.log(
        `No matching candidates: ${openSellers.length} sellers, ${openBuyers.length} buyers [cid=${correlationId}]`,
      );
      return result;
    }

    // Fetch current price once per matching run
    let priceResponse;
    try {
      priceResponse = await this.pricingClient.getCurrentPrice(correlationId);
    } catch (err) {
      this.logger.error(
        `Failed to fetch price, aborting matching: ${err.message} [cid=${correlationId}]`,
      );
      return result;
    }

    // Mutable copies to track remaining kWh across iterations
    const sellers = openSellers.map((s) => ({ ...s, availableKwh: s.availableKwh }));
    const buyers = openBuyers.map((b) => ({ ...b, requestedKwh: b.requestedKwh }));

    for (const seller of sellers) {
      for (const buyer of buyers) {
        if (seller.availableKwh <= 0) break; // seller exhausted
        if (buyer.requestedKwh <= 0) continue; // buyer already fulfilled

        if (seller.householdId === buyer.householdId) {
          result.skipped++;
          continue;
        }

        const tradeKwh = Math.min(seller.availableKwh, buyer.requestedKwh);
        const totalAmount = roundToDecimals(tradeKwh * priceResponse.pricePerKwh, 2);
        const tradeId = generateTradeId();
        const idempotencyKey = generateIdempotencyKey(
          'match',
          seller.id,
          buyer.id,
          String(Date.now()),
        );

        // Create PROPOSED trade match
        const tradeMatch = await this.prisma.tradeMatch.create({
          data: {
            tradeId,
            sellerHouseholdId: seller.householdId,
            buyerHouseholdId: buyer.householdId,
            energyKwh: tradeKwh,
            pricePerKwh: priceResponse.pricePerKwh,
            totalAmount,
            currency: priceResponse.currency,
            status: 'PROPOSED',
            idempotencyKey,
            correlationId,
          },
        });

        this.logger.log(
          `Proposed trade: seller=${seller.householdId} buyer=${buyer.householdId} kwh=${tradeKwh} price=${priceResponse.pricePerKwh} total=${totalAmount} [cid=${correlationId}]`,
        );

        try {
          await this.billingClient.createTrade({
            tradeId,
            sellerHouseholdId: seller.householdId,
            buyerHouseholdId: buyer.householdId,
            energyKwh: tradeKwh,
            pricePerKwh: priceResponse.pricePerKwh,
            totalAmount,
            currency: priceResponse.currency,
            idempotencyKey,
            correlationId,
            completedAt: new Date().toISOString(),
          });

          await this.prisma.tradeMatch.update({
            where: { id: tradeMatch.id },
            data: { status: 'COMPLETED' },
          });

          // Update seller remaining kWh
          const newSellerKwh = seller.availableKwh - tradeKwh;
          seller.availableKwh = newSellerKwh;
          await this.prisma.sellOffer.update({
            where: { id: seller.id },
            data: {
              availableKwh: newSellerKwh,
              status: newSellerKwh <= 0 ? 'MATCHED' : 'PARTIALLY_MATCHED',
            },
          });

          // Update buyer remaining kWh
          const newBuyerKwh = buyer.requestedKwh - tradeKwh;
          buyer.requestedKwh = newBuyerKwh;
          await this.prisma.buyRequest.update({
            where: { id: buyer.id },
            data: {
              requestedKwh: newBuyerKwh,
              status: newBuyerKwh <= 0 ? 'MATCHED' : 'PARTIALLY_MATCHED',
            },
          });

          result.matched++;
          this.logger.log(
            `Trade COMPLETED: ${tradeId} seller=${seller.householdId}(${newSellerKwh}kWh left) buyer=${buyer.householdId}(${newBuyerKwh}kWh left) [cid=${correlationId}]`,
          );
        } catch (err) {
          await this.prisma.tradeMatch.update({
            where: { id: tradeMatch.id },
            data: { status: 'FAILED', failureReason: err.message },
          });
          result.failed++;
          this.logger.error(
            `Trade FAILED: ${tradeId} reason=${err.message} [cid=${correlationId}]`,
          );
        }
      }
    }

    this.logger.log(
      `Matching complete: ${result.matched} matched, ${result.failed} failed, ${result.skipped} skipped [cid=${correlationId}]`,
    );
    return result;
  }

  async getMatches() {
    return this.prisma.tradeMatch.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getMatchByTradeId(tradeId: string) {
    return this.prisma.tradeMatch.findUnique({ where: { tradeId } });
  }
}
