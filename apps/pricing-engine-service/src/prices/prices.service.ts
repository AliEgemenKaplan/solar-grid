import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { RecalculatePriceDto } from './dto/recalculate-price.dto';
import { PriceResponseDto } from '@solar-grid/shared-contracts';
import { DecimalLike, formatEnergy, formatPrice, PRICE_SCALE } from '@solar-grid/shared-utils';
import { PriceSnapshot } from '../../generated/client';
import { Page, PaginationQuery, pageWindow, toPage } from '@solar-grid/nest-common';
import { PriceSnapshotResponse } from './dto/price.responses';

export interface PricingBand {
  basePrice: DecimalLike;
  minPrice: DecimalLike;
  maxPrice: DecimalLike;
}

const DEFAULT_RULE = {
  basePrice: '4.0000',
  minPrice: '2.5000',
  maxPrice: '7.0000',
  currency: 'TRY',
};

@Injectable()
export class PricesService implements OnModuleInit {
  private readonly logger = new Logger(PricesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultRule();
  }

  private async seedDefaultRule() {
    const count = await this.prisma.pricingRule.count({ where: { isActive: true } });
    if (count === 0) {
      await this.prisma.pricingRule.create({
        data: { ...DEFAULT_RULE, isActive: true },
      });
      this.logger.log({
        event: 'pricing.rule.seeded',
        message: 'Seeded the default pricing rule',
        basePrice: DEFAULT_RULE.basePrice,
        minPrice: DEFAULT_RULE.minPrice,
        maxPrice: DEFAULT_RULE.maxPrice,
        currency: DEFAULT_RULE.currency,
      });
    }
  }

  /**
   * price = clamp(basePrice * demand / max(supply, 1), minPrice, maxPrice)
   *
   * The division is the reason this is decimal arithmetic rather than floats:
   * the result is rounded once, deliberately, to the scale the price column
   * stores, instead of carrying a binary approximation around.
   */
  static calculatePrice(
    totalSupplyKwh: DecimalLike,
    totalDemandKwh: DecimalLike,
    rule: PricingBand,
  ): string {
    const supply = Decimal.max(new Decimal(String(totalSupplyKwh)), 1);
    const demand = new Decimal(String(totalDemandKwh));
    const raw = new Decimal(String(rule.basePrice)).mul(demand).div(supply);

    const clamped = raw.clamp(String(rule.minPrice), String(rule.maxPrice));
    return clamped.toFixed(PRICE_SCALE, Decimal.ROUND_HALF_UP);
  }

  async getCurrentPrice(): Promise<PriceResponseDto> {
    const snapshot = await this.prisma.priceSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (snapshot) {
      return toPriceResponse(snapshot);
    }

    // No trading has happened yet, so the band's base price is the price.
    const rule = await this.getActiveRule();
    return {
      pricePerKwh: formatPrice(rule.basePrice),
      currency: rule.currency,
      calculatedAt: new Date().toISOString(),
      supplyKwh: formatEnergy(0),
      demandKwh: formatEnergy(0),
    };
  }

  async recalculate(dto: RecalculatePriceDto): Promise<PriceResponseDto> {
    const rule = await this.getActiveRule();
    const price = PricesService.calculatePrice(dto.totalSupplyKwh, dto.totalDemandKwh, rule);

    const snapshot = await this.prisma.priceSnapshot.create({
      data: {
        totalSupplyKwh: formatEnergy(dto.totalSupplyKwh),
        totalDemandKwh: formatEnergy(dto.totalDemandKwh),
        calculatedPrice: price,
        currency: rule.currency,
      },
    });

    this.logger.log({
      event: 'price.recalculated',
      message: `Price recalculated: ${price} ${rule.currency}`,
      supplyKwh: dto.totalSupplyKwh,
      demandKwh: dto.totalDemandKwh,
      pricePerKwh: price,
      currency: rule.currency,
    });

    return toPriceResponse(snapshot);
  }

  /** Served by the createdAt index. */
  async getPriceHistory(query: PaginationQuery): Promise<Page<PriceSnapshotResponse>> {
    const [snapshots, total] = await this.prisma.$transaction([
      this.prisma.priceSnapshot.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.priceSnapshot.count(),
    ]);
    const items = snapshots.map((snapshot) => ({
      id: snapshot.id,
      totalSupplyKwh: formatEnergy(snapshot.totalSupplyKwh),
      totalDemandKwh: formatEnergy(snapshot.totalDemandKwh),
      calculatedPrice: formatPrice(snapshot.calculatedPrice),
      currency: snapshot.currency,
      createdAt: snapshot.createdAt.toISOString(),
    }));
    return toPage(items, total, query);
  }

  private async getActiveRule() {
    const rule = await this.prisma.pricingRule.findFirst({ where: { isActive: true } });
    if (!rule) throw new NotFoundException('No active pricing rule found');
    return rule;
  }
}

function toPriceResponse(snapshot: PriceSnapshot): PriceResponseDto {
  return {
    pricePerKwh: formatPrice(snapshot.calculatedPrice),
    currency: snapshot.currency,
    calculatedAt: snapshot.createdAt.toISOString(),
    supplyKwh: formatEnergy(snapshot.totalSupplyKwh),
    demandKwh: formatEnergy(snapshot.totalDemandKwh),
  };
}
