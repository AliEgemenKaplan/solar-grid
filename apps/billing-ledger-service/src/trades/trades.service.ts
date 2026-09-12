import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTrade(dto: CreateTradeDto) {
    // Check for existing idempotency key — return existing trade if duplicate
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
      return { ...existingTrade, duplicate: true };
    }

    this.logger.log(
      `Recording trade: tradeId=${dto.tradeId} seller=${dto.sellerHouseholdId} buyer=${dto.buyerHouseholdId} amount=${dto.totalAmount} ${dto.currency} [cid=${dto.correlationId}]`,
    );

    // Atomic transaction: trade record + ledger entries + idempotency key + balance updates
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

      await tx.ledgerEntry.create({
        data: {
          tradeId: dto.tradeId,
          householdId: dto.sellerHouseholdId,
          entryType: 'CREDIT',
          amount: dto.totalAmount,
          currency: dto.currency,
          correlationId: dto.correlationId,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tradeId: dto.tradeId,
          householdId: dto.buyerHouseholdId,
          entryType: 'DEBIT',
          amount: dto.totalAmount,
          currency: dto.currency,
          correlationId: dto.correlationId,
        },
      });

      await tx.householdBalance.upsert({
        where: { householdId: dto.sellerHouseholdId },
        update: { balance: { increment: dto.totalAmount } },
        create: {
          householdId: dto.sellerHouseholdId,
          balance: dto.totalAmount,
          currency: dto.currency,
        },
      });

      await tx.householdBalance.upsert({
        where: { householdId: dto.buyerHouseholdId },
        update: { balance: { decrement: dto.totalAmount } },
        create: {
          householdId: dto.buyerHouseholdId,
          balance: -dto.totalAmount,
          currency: dto.currency,
        },
      });

      return completedTrade;
    });

    this.logger.log(
      `Trade recorded successfully: tradeId=${dto.tradeId} seller+${dto.totalAmount} buyer-${dto.totalAmount} [cid=${dto.correlationId}]`,
    );

    return { ...trade, duplicate: false };
  }

  async getTradeById(tradeId: string) {
    return this.prisma.completedTrade.findUnique({ where: { tradeId } });
  }

  async getTradesByHousehold(householdId: string) {
    return this.prisma.completedTrade.findMany({
      where: {
        OR: [{ sellerHouseholdId: householdId }, { buyerHouseholdId: householdId }],
      },
      orderBy: { completedAt: 'desc' },
    });
  }
}
