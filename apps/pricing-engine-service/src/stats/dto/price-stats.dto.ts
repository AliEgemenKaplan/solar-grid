import { ApiProperty } from '@nestjs/swagger';
import { StatsRangeResponse, TIME_BUCKETS } from '@solar-grid/nest-common';

const ENERGY = { type: String, format: 'decimal', example: '50.000' } as const;
const PRICE = {
  type: String,
  format: 'decimal',
  example: '4.0000',
  nullable: true,
  description: 'Null when no price was calculated in the window',
} as const;

/** The band the price is clamped into, from the active pricing rule. */
export class PricingBandResponse {
  @ApiProperty({ type: String, format: 'decimal', example: '4.0000' }) basePrice!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '2.5000' }) minPrice!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '7.0000' }) maxPrice!: string;
  @ApiProperty({ example: 'TRY' }) currency!: string;
}

export class LatestPriceResponse {
  @ApiProperty({ type: String, format: 'decimal', example: '4.0000' }) pricePerKwh!: string;
  @ApiProperty(ENERGY) supplyKwh!: string;
  @ApiProperty(ENERGY) demandKwh!: string;
  @ApiProperty({ format: 'date-time' }) calculatedAt!: string;
}

export class PriceSummaryResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ example: 24, description: 'Price snapshots recorded in the window' })
  snapshots!: number;
  @ApiProperty(PRICE) averagePricePerKwh!: string | null;
  @ApiProperty(PRICE) minPricePerKwh!: string | null;
  @ApiProperty(PRICE) maxPricePerKwh!: string | null;
  @ApiProperty({ ...ENERGY, description: 'Mean supply the prices were calculated from' })
  averageSupplyKwh!: string;
  @ApiProperty({ ...ENERGY, description: 'Mean demand the prices were calculated from' })
  averageDemandKwh!: string;
  @ApiProperty({
    type: LatestPriceResponse,
    nullable: true,
    description: 'The newest snapshot in the window, or null when there is none',
  })
  latest!: LatestPriceResponse | null;
  @ApiProperty({
    type: PricingBandResponse,
    nullable: true,
    description:
      'The band prices are clamped into, as it stands now. Null only if no rule is active, which the service seeds at startup.',
  })
  band!: PricingBandResponse | null;
}

export class PriceTrendBucket {
  @ApiProperty({ format: 'date-time', description: 'Start of the bucket, UTC, inclusive' })
  bucketStart!: string;
  @ApiProperty({ example: 4 }) snapshots!: number;
  @ApiProperty(PRICE) averagePricePerKwh!: string | null;
  @ApiProperty(PRICE) minPricePerKwh!: string | null;
  @ApiProperty(PRICE) maxPricePerKwh!: string | null;
  @ApiProperty(ENERGY) averageSupplyKwh!: string;
  @ApiProperty(ENERGY) averageDemandKwh!: string;
}

export class PriceTrendResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ enum: TIME_BUCKETS }) bucket!: string;
  @ApiProperty({
    type: [PriceTrendBucket],
    description:
      'Every bucket in the window, oldest first. A bucket with no snapshot reports zeros.',
  })
  buckets!: PriceTrendBucket[];
}
