import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  HouseholdIdFilter,
  PaginationQuery,
  StatsRangeQuery,
  StatsRangeResponse,
  TIME_BUCKETS,
} from '@solar-grid/nest-common';

const ENERGY = { type: String, format: 'decimal', example: '124.500' } as const;

/** What the meters recorded, over the window the query asked for. */
export class EnergySummaryResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;

  @ApiProperty({ example: 240, description: 'Readings stored in the window' })
  readings!: number;

  @ApiProperty({ example: 12, description: 'Households that reported at least once' })
  households!: number;

  @ApiProperty({ ...ENERGY, description: 'Energy the households generated' })
  productionKwh!: string;

  @ApiProperty({ ...ENERGY, description: 'Energy the households used' })
  consumptionKwh!: string;

  @ApiProperty({ ...ENERGY, description: 'Production minus consumption, which may be negative' })
  netKwh!: string;

  @ApiProperty({
    ...ENERGY,
    description: 'Energy offered to the neighbourhood by surplus readings',
  })
  surplusKwh!: string;

  @ApiProperty({
    ...ENERGY,
    description: 'Energy wanted from the neighbourhood by demand readings',
  })
  demandKwh!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  firstReadingAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastReadingAt!: string | null;
}

/** One household's meter activity. */
export class HouseholdEnergyStatsResponse {
  @ApiProperty({ example: 'HH-SELLER-001' }) householdId!: string;
  @ApiProperty({ example: 20 }) readings!: number;
  @ApiProperty(ENERGY) productionKwh!: string;
  @ApiProperty(ENERGY) consumptionKwh!: string;
  @ApiProperty(ENERGY) netKwh!: string;
  @ApiProperty(ENERGY) surplusKwh!: string;
  @ApiProperty(ENERGY) demandKwh!: string;
  @ApiProperty({ format: 'date-time' }) firstReadingAt!: string;
  @ApiProperty({ format: 'date-time' }) lastReadingAt!: string;
}

export class EnergyTrendBucket {
  @ApiProperty({ format: 'date-time', description: 'Start of the bucket, UTC, inclusive' })
  bucketStart!: string;

  @ApiProperty({ example: 10 }) readings!: number;
  @ApiProperty({ example: 3 }) households!: number;
  @ApiProperty(ENERGY) productionKwh!: string;
  @ApiProperty(ENERGY) consumptionKwh!: string;
  @ApiProperty(ENERGY) netKwh!: string;
}

export class EnergyTrendResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ enum: TIME_BUCKETS }) bucket!: string;

  @ApiProperty({
    type: [EnergyTrendBucket],
    description: 'Every bucket in the window, oldest first. A quiet bucket reports zeros.',
  })
  buckets!: EnergyTrendBucket[];
}

export class HouseholdEnergyStatsQuery extends IntersectionType(PaginationQuery, StatsRangeQuery) {
  @HouseholdIdFilter('Only this household')
  householdId?: string;
}
