import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { formatEnergy, formatMoney, formatPrice } from '@solar-grid/shared-utils';
import { CompletedTrade, Prisma } from '../../generated/client';

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTrade(dto: CreateTradeDto) {
    if (dto.sellerHouseholdId === dto.buyerHouseholdId) {
      // The database refuses this too; answering here turns a constraint
      // violation into an answer the caller can act on.
      throw new BadRequestException('A household cannot trade with itself');
    }

    // Check for existing idempotency key - return existing trade if duplicate
    const existingKey = await this.prisma.idempotencyKey.findUnique({
      where: { key: dto.idempotencyKey },
    });

    if (existingKey) {
      this.logger.warn(
        `Duplicate trade rejected: idempotencyKey=${dto.idempotencyKey} tradeId=${existingKey.tradeId} [cid=${dto.correlationId}]`,
      );
      const existingTrade = await this.prisma.completedTrade.findUnique({
        where: { tradeId: existingKey.tradeId },
      });
      return existingTrade ? toTradeResponse(existingTrade, true) : null;
    }

    this.logger.log(
      `Recording trade: tradeId=${dto.tradeId} seller=${dto.sellerHouseholdId} buyer=${dto.buyerHouseholdId} amount=${dto.totalAmount} ${dto.currency} [cid=${dto.correlationId}]`,
    );

    // Atomic transaction: trade record + ledger entries + idempotency key + balance updates
    try {
      const trade = await this.prisma.$transaction(async (tx) => {
        const completedTrade = await tx.completedTrade.create({
          data: {
            tradeId: dto.tradeId,
            sellerHouseholdId: dto.sellerHouseholdId,
            buyerHouseholdId: dto.buyerHouseholdId,
            energyKwh: dto.energyKwh,
            pricePerKwh: dto.pricePerKwh,
            totalAmount: dto.totalAmount,
            currency: dto.currency,
            idempotencyKey: dto.idempotencyKey,
            correlationId: dto.correlationId,
            completedAt: new Date(dto.completedAt),
          },
        });

        await tx.idempotencyKey.create({
          data: {
            key: dto.idempotencyKey,
            tradeId: dto.tradeId,
          },
        });

        // One credit and one debit. The unique index on
        // (tradeId, householdId, entryType) means a second attempt to settle
        // this trade cannot write a second pair, whatever the caller does.
        await tx.ledgerEntry.createMany({
          data: [
            {
              tradeId: dto.tradeId,
              householdId: dto.sellerHouseholdId,
              entryType: 'CREDIT',
              amount: dto.totalAmount,
              currency: dto.currency,
              correlationId: dto.correlationId,
            },
            {
              tradeId: dto.tradeId,
              householdId: dto.buyerHouseholdId,
              entryType: 'DEBIT',
              amount: dto.totalAmount,
              currency: dto.currency,
              correlationId: dto.correlationId,
            },
          ],
        });

        // Always touch balances in the same order, sorted by household id.
        // Two trades running in opposite directions between the same pair
        // would otherwise each hold the row the other needs, and Postgres
        // would break the deadlock by killing one of them.
        const debit = new Decimal(dto.totalAmount).negated().toFixed(2);
        const movements = [
          { householdId: dto.sellerHouseholdId, delta: dto.totalAmount },
          { householdId: dto.buyerHouseholdId, delta: debit },
        ].sort((a, b) => a.householdId.localeCompare(b.householdId));

        for (const movement of movements) {
          await tx.householdBalance.upsert({
            where: { householdId: movement.householdId },
            update: { balance: { increment: movement.delta } },
            create: {
              householdId: movement.householdId,
              balance: movement.delta,
              currency: dto.currency,
            },
          });
        }

        return completedTrade;
      });

      this.logger.log(
        `Trade recorded successfully: tradeId=${dto.tradeId} seller+${dto.totalAmount} buyer-${dto.totalAmount} [cid=${dto.correlationId}]`,
      );

      return toTradeResponse(trade, false);
    } catch (err) {
      // Checking for the key before inserting leaves a gap: two requests
      // carrying the same key can both pass the check. The unique index is
      // what actually decides, so the request that loses the race reports the
      // winner's trade instead of a 500.
      if (isUniqueViolation(err)) {
        const winner = await this.prisma.completedTrade.findUnique({
          where: { tradeId: dto.tradeId },
        });
        if (winner) {
          this.logger.warn(
            `Concurrent duplicate trade resolved: idempotencyKey=${dto.idempotencyKey} tradeId=${dto.tradeId} [cid=${dto.correlationId}]`,
          );
          return toTradeResponse(winner, true);
        }
      }
      throw err;
    }
  }

  async getTradeById(tradeId: string) {
    const trade = await this.prisma.completedTrade.findUnique({ where: { tradeId } });
    return trade ? toTradeResponse(trade, false) : null;
  }

  async getTradesByHousehold(householdId: string) {
    const trades = await this.prisma.completedTrade.findMany({
      where: {
        OR: [{ sellerHouseholdId: householdId }, { buyerHouseholdId: householdId }],
      },
      orderBy: { completedAt: 'desc' },
    });
    return trades.map((trade) => toTradeResponse(trade, false));
  }
}

/** Money and energy leave this service as fixed-scale decimal strings. */
function toTradeResponse(trade: CompletedTrade, duplicate: boolean) {
  return {
    id: trade.id,
    tradeId: trade.tradeId,
    sellerHouseholdId: trade.sellerHouseholdId,
    buyerHouseholdId: trade.buyerHouseholdId,
    energyKwh: formatEnergy(trade.energyKwh),
    pricePerKwh: formatPrice(trade.pricePerKwh),
    totalAmount: formatMoney(trade.totalAmount),
    currency: trade.currency,
    idempotencyKey: trade.idempotencyKey,
    correlationId: trade.correlationId,
    completedAt: trade.completedAt.toISOString(),
    createdAt: trade.createdAt.toISOString(),
    duplicate,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
