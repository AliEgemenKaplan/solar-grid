import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingClient } from '../clients/pricing.client';
import { BillingClient, BillingRejectedError } from '../clients/billing.client';
import Decimal from 'decimal.js';
import {
  DecimalLike,
  formatEnergy,
  formatMoney,
  formatPrice,
  generateTradeId,
  MONEY_SCALE,
} from '@solar-grid/shared-utils';
import { PlannedTrade, planTrades } from './matching.planner';
import type { Prisma, SellOffer, BuyRequest, TradeMatch } from '../../generated/client';

export interface MatchResult {
  matched: number;
  failed: number;
  skipped: number;
  /** Reserved energy whose billing outcome is still unknown. */
  pending: number;
  /** Trades reserved by an earlier run and confirmed during this one. */
  settled: number;
}

type BillingOutcome = 'completed' | 'failed' | 'pending';

type TransactionClient = Prisma.TransactionClient;

/**
 * Any 64-bit number works as long as every matching run uses the same one.
 * Postgres hands the lock to one transaction at a time, which is what keeps
 * two concurrent runs from selling the same kilowatt hour.
 */
const MATCHING_LOCK_KEY = 4815162342;

/** How many unconfirmed trades one run will try to settle. */
const SETTLEMENT_BATCH_SIZE = 50;

class ReservationConflict extends Error {}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingClient: PricingClient,
    private readonly billingClient: BillingClient,
  ) {}

  /**
   * Reserve, bill, then confirm.
   *
   * Energy is taken off the offer and the request before billing is called,
   * in one transaction, so it cannot be sold twice while we wait for an
   * answer. The trade carries an idempotency key derived from its own id, so
   * a retry after a timeout is recognised by billing as the same trade rather
   * than charged again.
   */
  async runMatching(correlationId: string): Promise<MatchResult> {
    const result: MatchResult = { matched: 0, failed: 0, skipped: 0, pending: 0, settled: 0 };

    // Trades left unconfirmed by an earlier run hold energy and owe a ledger
    // entry, so they are retried before anything new is matched.
    const settlement = await this.settlePendingTrades();
    result.settled = settlement.settled;
    result.failed += settlement.failed;
    result.pending += settlement.stillPending;

    const [offers, requests] = await Promise.all([
      this.prisma.sellOffer.findMany({
        where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.buyRequest.findMany({
        where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (offers.length === 0 || requests.length === 0) {
      this.logger.log(
        `No matching candidates: ${offers.length} sellers, ${requests.length} buyers [cid=${correlationId}]`,
      );
      return result;
    }

    const plan = planTrades(offers, requests);
    result.skipped = plan.skippedSelfMatches;

    if (plan.trades.length === 0) {
      this.logger.log(`Nothing to match [cid=${correlationId}]`);
      return result;
    }

    let price;
    try {
      price = await this.pricingClient.getCurrentPrice(correlationId);
    } catch (err) {
      this.logger.error(
        `Failed to fetch price, aborting matching: ${describe(err)} [cid=${correlationId}]`,
      );
      return result;
    }

    for (const planned of plan.trades) {
      const match = await this.reserve(planned, price, correlationId);
      if (!match) {
        // Another run reserved this energy between planning and reserving.
        this.logger.debug(
          `Skipped trade, energy no longer available: offer=${planned.offerId} request=${planned.requestId} [cid=${correlationId}]`,
        );
        continue;
      }

      const outcome = await this.billAndSettle(match);
      if (outcome === 'completed') result.matched++;
      else if (outcome === 'failed') result.failed++;
      else result.pending++;
    }

    this.logger.log(
      `Matching complete: ${result.matched} matched, ${result.failed} failed, ${result.skipped} skipped, ${result.pending} awaiting billing, ${result.settled} settled [cid=${correlationId}]`,
    );
    return result;
  }

  /**
   * Takes the energy out of the offer and the request and records the trade,
   * all or nothing. Returns null when the energy has already gone, which is
   * a normal outcome, not an error.
   */
  private async reserve(
    planned: PlannedTrade,
    price: { pricePerKwh: string; currency: string },
    correlationId: string,
  ): Promise<TradeMatch | null> {
    const tradeId = generateTradeId();
    // Exact decimal arithmetic, rounded once to the scale the column stores.
    const totalAmount = new Decimal(planned.energyKwh)
      .mul(price.pricePerKwh)
      .toFixed(MONEY_SCALE, Decimal.ROUND_HALF_UP);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialises reservations across every instance and every trigger,
        // and is released when this transaction ends. No HTTP call happens
        // while it is held.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MATCHING_LOCK_KEY}::bigint)`;

        // The amount check belongs in the UPDATE itself: Postgres re-evaluates
        // it against the committed row, so a competing transaction cannot slip
        // between a read and a write.
        const offerUpdate = await tx.sellOffer.updateMany({
          where: { id: planned.offerId, availableKwh: { gte: planned.energyKwh } },
          data: { availableKwh: { decrement: planned.energyKwh } },
        });
        if (offerUpdate.count === 0) return null;

        const requestUpdate = await tx.buyRequest.updateMany({
          where: { id: planned.requestId, requestedKwh: { gte: planned.energyKwh } },
          data: { requestedKwh: { decrement: planned.energyKwh } },
        });
        if (requestUpdate.count === 0) {
          // Give the reserved energy back by rolling the whole thing back.
          throw new ReservationConflict();
        }

        await this.syncOfferStatus(tx, planned.offerId);
        await this.syncRequestStatus(tx, planned.requestId);

        const match = await tx.tradeMatch.create({
          data: {
            tradeId,
            sellerHouseholdId: planned.sellerHouseholdId,
            buyerHouseholdId: planned.buyerHouseholdId,
            energyKwh: planned.energyKwh,
            pricePerKwh: price.pricePerKwh,
            totalAmount,
            currency: price.currency,
            status: 'PENDING_BILLING',
            offerId: planned.offerId,
            requestId: planned.requestId,
            // Derived from the trade and never regenerated, so every attempt
            // to bill this trade carries the same key.
            idempotencyKey: tradeId,
            correlationId,
          },
        });

        this.logger.log(
          `Reserved trade: ${tradeId} seller=${planned.sellerHouseholdId} buyer=${planned.buyerHouseholdId} kwh=${planned.energyKwh} total=${totalAmount} ${price.currency} [cid=${correlationId}]`,
        );
        return match;
      });
    } catch (err) {
      if (err instanceof ReservationConflict) return null;
      throw err;
    }
  }

  /** Calls billing for a reserved trade and records what came back. */
  private async billAndSettle(match: TradeMatch): Promise<BillingOutcome> {
    await this.prisma.tradeMatch.update({
      where: { id: match.id },
      data: { billingAttempts: { increment: 1 } },
    });

    try {
      const response = await this.billingClient.createTrade({
        tradeId: match.tradeId,
        sellerHouseholdId: match.sellerHouseholdId,
        buyerHouseholdId: match.buyerHouseholdId,
        energyKwh: formatEnergy(match.energyKwh),
        pricePerKwh: formatPrice(match.pricePerKwh),
        totalAmount: formatMoney(match.totalAmount),
        currency: match.currency,
        idempotencyKey: match.idempotencyKey,
        correlationId: match.correlationId,
        // The reservation time, not "now": a retry has to send the same
        // payload it sent the first time.
        completedAt: match.createdAt.toISOString(),
      });

      await this.prisma.tradeMatch.update({
        where: { id: match.id },
        data: {
          status: 'COMPLETED',
          billingTradeId: response.tradeId ?? match.tradeId,
          failureReason: null,
        },
      });

      const recognised = response.duplicate ? ' (billing had already recorded it)' : '';
      this.logger.log(
        `Trade COMPLETED: ${match.tradeId} kwh=${match.energyKwh} total=${match.totalAmount} ${match.currency}${recognised} [cid=${match.correlationId}]`,
      );
      return 'completed';
    } catch (err) {
      const reason = describe(err);

      if (err instanceof BillingRejectedError) {
        await this.releaseReservation(match, reason);
        this.logger.error(
          `Trade REJECTED by billing, energy released: ${match.tradeId} reason=${reason} [cid=${match.correlationId}]`,
        );
        return 'failed';
      }

      // Unknown outcome. The energy stays reserved and the trade keeps its
      // idempotency key so the next run can ask billing again safely.
      await this.prisma.tradeMatch.update({
        where: { id: match.id },
        data: { failureReason: reason },
      });
      this.logger.warn(
        `Trade billing outcome unknown, staying reserved for retry: ${match.tradeId} reason=${reason} [cid=${match.correlationId}]`,
      );
      return 'pending';
    }
  }

  /** Retries trades that were reserved but never got an answer from billing. */
  private async settlePendingTrades(): Promise<{
    settled: number;
    failed: number;
    stillPending: number;
  }> {
    const pending = await this.prisma.tradeMatch.findMany({
      where: { status: 'PENDING_BILLING' },
      orderBy: { createdAt: 'asc' },
      take: SETTLEMENT_BATCH_SIZE,
    });

    let settled = 0;
    let failed = 0;

    for (let index = 0; index < pending.length; index++) {
      const outcome = await this.billAndSettle(pending[index]);
      if (outcome === 'completed') {
        settled++;
      } else if (outcome === 'failed') {
        failed++;
      } else {
        // Billing is still not answering; leave the rest for the next run
        // instead of repeating the same failure for every trade.
        return { settled, failed, stillPending: pending.length - index };
      }
    }

    if (settled > 0 || failed > 0) {
      this.logger.log(
        `Settled ${settled} and released ${failed} trade(s) left over from earlier runs`,
      );
    }
    return { settled, failed, stillPending: 0 };
  }

  /** Gives reserved energy back after billing refused the trade outright. */
  private async releaseReservation(match: TradeMatch, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sellOffer.update({
        where: { id: match.offerId },
        data: { availableKwh: { increment: match.energyKwh } },
      });
      await tx.buyRequest.update({
        where: { id: match.requestId },
        data: { requestedKwh: { increment: match.energyKwh } },
      });
      await this.syncOfferStatus(tx, match.offerId);
      await this.syncRequestStatus(tx, match.requestId);
      await tx.tradeMatch.update({
        where: { id: match.id },
        data: { status: 'FAILED', failureReason: reason },
      });
    });
  }

  private async syncOfferStatus(tx: TransactionClient, offerId: string): Promise<void> {
    const offer = await tx.sellOffer.findUniqueOrThrow({ where: { id: offerId } });
    const status = statusFor(offer.availableKwh, offer.originalKwh);
    if (offer.status !== status) {
      await tx.sellOffer.update({ where: { id: offerId }, data: { status } });
    }
  }

  private async syncRequestStatus(tx: TransactionClient, requestId: string): Promise<void> {
    const request = await tx.buyRequest.findUniqueOrThrow({ where: { id: requestId } });
    const status = statusFor(request.requestedKwh, request.originalKwh);
    if (request.status !== status) {
      await tx.buyRequest.update({ where: { id: requestId }, data: { status } });
    }
  }

  async getMatches() {
    const matches = await this.prisma.tradeMatch.findMany({ orderBy: { createdAt: 'desc' } });
    return matches.map(toTradeResponse);
  }

  async getMatchByTradeId(tradeId: string) {
    const match = await this.prisma.tradeMatch.findUnique({ where: { tradeId } });
    return match ? toTradeResponse(match) : null;
  }
}

/** Money and energy leave this service as fixed-scale decimal strings. */
export function toTradeResponse(match: TradeMatch) {
  return {
    id: match.id,
    tradeId: match.tradeId,
    sellerHouseholdId: match.sellerHouseholdId,
    buyerHouseholdId: match.buyerHouseholdId,
    energyKwh: formatEnergy(match.energyKwh),
    pricePerKwh: formatPrice(match.pricePerKwh),
    totalAmount: formatMoney(match.totalAmount),
    currency: match.currency,
    status: match.status,
    billingTradeId: match.billingTradeId,
    offerId: match.offerId,
    requestId: match.requestId,
    idempotencyKey: match.idempotencyKey,
    billingAttempts: match.billingAttempts,
    correlationId: match.correlationId,
    failureReason: match.failureReason,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
  };
}

export function toOfferResponse(offer: SellOffer) {
  return {
    id: offer.id,
    householdId: offer.householdId,
    sourceEventId: offer.sourceEventId,
    availableKwh: formatEnergy(offer.availableKwh),
    originalKwh: formatEnergy(offer.originalKwh),
    status: offer.status,
    correlationId: offer.correlationId,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
}

export function toRequestResponse(request: BuyRequest) {
  return {
    id: request.id,
    householdId: request.householdId,
    sourceEventId: request.sourceEventId,
    requestedKwh: formatEnergy(request.requestedKwh),
    originalKwh: formatEnergy(request.originalKwh),
    status: request.status,
    correlationId: request.correlationId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

/**
 * OPEN, PARTIALLY_MATCHED and MATCHED are just views of how much is left.
 * With decimal amounts these are exact comparisons; the old float version
 * needed an epsilon to decide whether 1e-17 kWh counted as exhausted.
 */
function statusFor(
  remainingKwh: DecimalLike,
  originalKwh: DecimalLike,
): 'OPEN' | 'PARTIALLY_MATCHED' | 'MATCHED' {
  const remaining = new Decimal(String(remainingKwh));
  if (remaining.lte(0)) return 'MATCHED';
  if (remaining.gte(String(originalKwh))) return 'OPEN';
  return 'PARTIALLY_MATCHED';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
