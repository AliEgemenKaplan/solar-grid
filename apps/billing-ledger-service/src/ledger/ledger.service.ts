import { Injectable } from '@nestjs/common';
import { formatMoney } from '@solar-grid/shared-utils';
import { Page, pageWindow, toPage } from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceResponse, LedgerEntryResponse, LedgerQuery } from '../trades/dto/trade.responses';
import { Prisma } from '../../generated/client';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Served by the (householdId, createdAt) index. */
  async listEntries(householdId: string, query: LedgerQuery): Promise<Page<LedgerEntryResponse>> {
    const where: Prisma.LedgerEntryWhereInput = {
      householdId,
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    };

    const [entries, total] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return toPage(
      entries.map((entry) => ({
        id: entry.id,
        tradeId: entry.tradeId,
        householdId: entry.householdId,
        entryType: entry.entryType,
        amount: formatMoney(entry.amount),
        currency: entry.currency,
        correlationId: entry.correlationId,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  /**
   * A household that has never traded has a balance of zero, not a missing
   * balance: billing does not keep a household registry, so "no trades yet"
   * and "unknown" are the same thing from here.
   */
  async getBalance(householdId: string): Promise<BalanceResponse> {
    const balance = await this.prisma.householdBalance.findUnique({ where: { householdId } });
    if (!balance) {
      return { householdId, balance: formatMoney(0), currency: 'TRY', updatedAt: null };
    }
    return {
      householdId: balance.householdId,
      balance: formatMoney(balance.balance),
      currency: balance.currency,
      updatedAt: balance.updatedAt.toISOString(),
    };
  }
}
