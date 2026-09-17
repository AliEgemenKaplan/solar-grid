import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { CompletedTradeResponse, TradeListQuery } from './dto/trade.responses';
import { differingFields, expectedTotal, tradeRequestFingerprint } from './request-fingerprint';
import { formatEnergy, formatMoney, formatPrice, MONEY_SCALE } from '@solar-grid/shared-utils';
import {
  BusinessRuleViolationException,
  IdempotencyConflictException,
  Page,
  pageWindow,
  ResourceConflictException,
  ResourceNotFoundException,
  toPage,
} from '@solar-grid/nest-common';
import { CompletedTrade, Prisma } from '../../generated/client';

export interface RecordedTrade {
  trade: CompletedTradeResponse;
  /** False when the idempotency key was already recorded and the stored trade is returned. */
  created: boolean;
}

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a completed trade exactly once.
   *
   *   same key, same payload       → the stored trade, created: false
   *   same key, different payload  → 409 IDEMPOTENCY_CONFLICT
   *   same trade id, different key → 409 CONFLICT
   *   impossible trade             → 422 BUSINESS_RULE_VIOLATION
   */
  async createTrade(dto: CreateTradeDto): Promise<RecordedTrade> {
    this.assertBusinessRules(dto);

    const fingerprint = tradeRequestFingerprint(dto);

    const replay = await this.findReplay(dto, fingerprint);
    if (replay) return { trade: replay, created: false };

    this.logger.log({
      event: 'trade.recording',
      message: 'Recording trade',
      tradeId: dto.tradeId,
      idempotencyKey: dto.idempotencyKey,
      sellerHouseholdId: dto.sellerHouseholdId,
      buyerHouseholdId: dto.buyerHouseholdId,
      totalAmount: dto.totalAmount,
      currency: dto.currency,
      correlationId: dto.correlationId,
    });

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
            requestHash: fingerprint,
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
        const debit = new Decimal(dto.totalAmount).negated().toFixed(MONEY_SCALE);
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

      this.logger.log({
        event: 'trade.recorded',
        message: 'Trade recorded: seller credited, buyer debited',
        tradeId: dto.tradeId,
        totalAmount: dto.totalAmount,
        currency: dto.currency,
        correlationId: dto.correlationId,
      });
      return { trade: toTradeResponse(trade, false), created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;

      // Another request got there first. If it carried the same key, this is
      // a replay and gets the same answer (or a conflict, if the payloads
      // differ). If not, the trade id is already taken under another key.
      const replayAfterRace = await this.findReplay(dto, fingerprint);
      if (replayAfterRace) return { trade: replayAfterRace, created: false };

      throw new ResourceConflictException(
        `Trade ${dto.tradeId} has already been recorded under a different idempotency key.`,
      );
    }
  }

  async getTradeById(tradeId: string): Promise<CompletedTradeResponse> {
    const trade = await this.prisma.completedTrade.findUnique({ where: { tradeId } });
    if (!trade) throw new ResourceNotFoundException(`Trade ${tradeId} does not exist.`);
    return toTradeResponse(trade, false);
  }

  async listTrades(query: TradeListQuery): Promise<Page<CompletedTradeResponse>> {
    const where: Prisma.CompletedTradeWhereInput = {
      ...(query.householdId
        ? {
            OR: [{ sellerHouseholdId: query.householdId }, { buyerHouseholdId: query.householdId }],
          }
        : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    };

    const [trades, total] = await this.prisma.$transaction([
      this.prisma.completedTrade.findMany({
        where,
        // id breaks ties so the same page never shows a row twice.
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.completedTrade.count({ where }),
    ]);

    return toPage(
      trades.map((trade) => toTradeResponse(trade, false)),
      total,
      query,
    );
  }

  /**
   * A household trading with itself, or a total that is not the energy times
   * the price, is well formed and still impossible. Both are also refused by
   * the database; answering here gives the caller a reason instead of a 500.
   */
  private assertBusinessRules(dto: CreateTradeDto): void {
    if (dto.sellerHouseholdId === dto.buyerHouseholdId) {
      throw new BusinessRuleViolationException('A household cannot trade with itself.');
    }

    const expected = expectedTotal(dto.energyKwh, dto.pricePerKwh);
    const received = formatMoney(dto.totalAmount);
    if (received !== expected) {
      throw new BusinessRuleViolationException(
        'totalAmount does not equal energyKwh multiplied by pricePerKwh.',
        [`expected ${expected}, received ${received}`],
      );
    }
  }

  /**
   * The stored trade when this key has been recorded with the same request,
   * null when the key is new, and a conflict when the key was used for
   * something else.
   */
  private async findReplay(
    dto: CreateTradeDto,
    fingerprint: string,
  ): Promise<CompletedTradeResponse | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: dto.idempotencyKey },
      include: { trade: true },
    });
    if (!existing) return null;

    // A key recorded before request hashing existed has no hash to compare,
    // and is treated as a match rather than breaking old retries.
    if (existing.requestHash && existing.requestHash !== fingerprint) {
      const fields = differingFields(existing.trade, dto);
      this.logger.warn({
        event: 'trade.idempotency_conflict',
        message: 'Idempotency key reused for a different trade',
        idempotencyKey: dto.idempotencyKey,
        tradeId: dto.tradeId,
        differingFields: fields,
        correlationId: dto.correlationId,
      });
      throw new IdempotencyConflictException(
        'This idempotency key was already used for a different trade.',
        fields.map((field) => `${field} differs from the recorded trade`),
      );
    }

    this.logger.log({
      event: 'trade.replayed',
      message: 'Repeated trade answered from the ledger',
      idempotencyKey: dto.idempotencyKey,
      tradeId: existing.tradeId,
      correlationId: dto.correlationId,
    });
    return toTradeResponse(existing.trade, true);
  }
}

/** Money and energy leave this service as fixed-scale decimal strings. */
export function toTradeResponse(trade: CompletedTrade, duplicate: boolean): CompletedTradeResponse {
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
