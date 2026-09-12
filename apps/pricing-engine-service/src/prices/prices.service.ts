import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecalculatePriceDto } from './dto/recalculate-price.dto';
import { PriceResponseDto } from '@solar-grid/shared-contracts';
import { clamp, roundToDecimals } from '@solar-grid/shared-utils';

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
        data: {
          basePrice: 4.0,
          minPrice: 2.5,
          maxPrice: 7.0,
          currency: 'TRY',
          isActive: true,
        },
      });
      this.logger.log('Seeded default pricing rule: base=4.00 min=2.50 max=7.00 TRY/kWh');
    }
  }

  static calculatePrice(
    totalSupplyKwh: number,
    totalDemandKwh: number,
    rule: { basePrice: number; minPrice: number; maxPrice: number },
  ): number {
    const supplyDemandFactor = totalDemandKwh / Math.max(totalSupplyKwh, 1);
    const rawPrice = rule.basePrice * supplyDemandFactor;
    return roundToDecimals(clamp(rawPrice, rule.minPrice, rule.maxPrice), 4);
  }

  async getCurrentPrice(): Promise<PriceResponseDto> {
    const snapshot = await this.prisma.priceSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const rule = await this.getActiveRule();

    if (!snapshot) {
      return {
        pricePerKwh: rule.basePrice,
        currency: rule.currency,
        calculatedAt: new Date().toISOString(),
        supplyKwh: 0,
        demandKwh: 0,
      };
    }

    return {
      pricePerKwh: snapshot.calculatedPrice,
      currency: snapshot.currency,
      calculatedAt: snapshot.createdAt.toISOString(),
      supplyKwh: snapshot.totalSupplyKwh,
      demandKwh: snapshot.totalDemandKwh,
    };
  }

  async recalculate(dto: RecalculatePriceDto): Promise<PriceResponseDto> {
    const rule = await this.getActiveRule();
    const price = PricesService.calculatePrice(dto.totalSupplyKwh, dto.totalDemandKwh, rule);

    const snapshot = await this.prisma.priceSnapshot.create({
      data: {
        totalSupplyKwh: dto.totalSupplyKwh,
        totalDemandKwh: dto.totalDemandKwh,
        calculatedPrice: price,
        currency: rule.currency,
      },
    });

    this.logger.log(
      `Price recalculated: supply=${dto.totalSupplyKwh} demand=${dto.totalDemandKwh} price=${price} ${rule.currency}`,
    );

    return {
      pricePerKwh: snapshot.calculatedPrice,
      currency: snapshot.currency,
      calculatedAt: snapshot.createdAt.toISOString(),
      supplyKwh: snapshot.totalSupplyKwh,
      demandKwh: snapshot.totalDemandKwh,
    };
  }

  async getPriceHistory(limit = 50) {
    return this.prisma.priceSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async getActiveRule() {
    const rule = await this.prisma.pricingRule.findFirst({ where: { isActive: true } });
    if (!rule) throw new NotFoundException('No active pricing rule found');
    return rule;
  }
}
