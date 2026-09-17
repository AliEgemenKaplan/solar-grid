import { ApiProperty, IntersectionType } from '@nestjs/swagger';
import {
  HouseholdIdFilter,
  PaginationQuery,
  StatsRangeQuery,
  StatsRangeResponse,
  TIME_BUCKETS,
} from '@solar-grid/nest-common';

const ENERGY = { type: String, format: 'decimal', example: '124.500' } as const;
const MONEY = { type: String, format: 'decimal', example: '498.00' } as const;
const PRICE = {
  type: String,
  format: 'decimal',
  example: '4.0000',
  nullable: true,
  description: 'Null when there were no completed trades in the window',
} as const;

export class TradeCounts {
  @ApiProperty({ example: 42 }) total!: number;
  @ApiProperty({ example: 40 }) completed!: number;
  @ApiProperty({ example: 1, description: 'Reserved, waiting for a billing answer' })
  pendingBilling!: number;
  @ApiProperty({ example: 1, description: 'Billing refused them; their energy went back' })
  failed!: number;
}

export class CompletedTradeStats {
  @ApiProperty(ENERGY) energyKwh!: string;
  @ApiProperty({ ...MONEY, description: 'What the completed trades were worth' })
  volume!: string;
  @ApiProperty({ ...PRICE, description: 'Mean price of a trade' })
  averagePricePerKwh!: string | null;
  @ApiProperty({
    ...PRICE,
    description: 'Volume divided by energy: what the neighbourhood actually paid per kWh',
  })
  volumeWeightedPricePerKwh!: string | null;
  @ApiProperty(PRICE) minPricePerKwh!: string | null;
  @ApiProperty(PRICE) maxPricePerKwh!: string | null;
}

export class ReservedTradeStats {
  @ApiProperty(ENERGY) energyKwh!: string;
  @ApiProperty(MONEY) volume!: string;
}

/**
 * How much energy was offered or asked for, and how much of it found a
 * counterparty. The counts and the open energy describe the state right now;
 * the window selects which offers and requests are looked at by when they
 * were created.
 */
export class BookStats {
  @ApiProperty({ example: 30 }) total!: number;
  @ApiProperty({ example: 4 }) open!: number;
  @ApiProperty({ example: 2 }) partiallyMatched!: number;
  @ApiProperty({ example: 24 }) matched!: number;
  @ApiProperty({ example: 0 }) cancelled!: number;
  @ApiProperty({ ...ENERGY, description: 'Energy these offers or requests were opened with' })
  totalKwh!: string;
  @ApiProperty({ ...ENERGY, description: 'Energy of theirs that has been traded' })
  matchedKwh!: string;
  @ApiProperty({ ...ENERGY, description: 'Energy still waiting for a counterparty' })
  openKwh!: string;
}

export class TradeSummaryResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty({ example: 12, description: 'Households that bought or sold in the window' })
  households!: number;
  @ApiProperty({ type: TradeCounts }) trades!: TradeCounts;
  @ApiProperty({ type: CompletedTradeStats }) completed!: CompletedTradeStats;
  @ApiProperty({ type: ReservedTradeStats, description: 'Reserved but not yet settled' })
  pending!: ReservedTradeStats;
  @ApiProperty({ type: BookStats }) offers!: BookStats;
  @ApiProperty({ type: BookStats }) requests!: BookStats;
}

/** One household's completed trading. */
export class HouseholdTradeStatsResponse {
  @ApiProperty({ example: 'HH-SELLER-001' }) householdId!: string;
  @ApiProperty({ example: 6 }) tradesAsSeller!: number;
  @ApiProperty({ example: 2 }) tradesAsBuyer!: number;
  @ApiProperty(ENERGY) soldKwh!: string;
  @ApiProperty(ENERGY) boughtKwh!: string;
  @ApiProperty({ ...MONEY, description: 'Earned by selling' }) sellVolume!: string;
  @ApiProperty({ ...MONEY, description: 'Owed for buying' }) buyVolume!: string;
  @ApiProperty({ ...MONEY, description: 'Sales minus purchases, negative for a net buyer' })
  netVolume!: string;
  @ApiProperty({ format: 'date-time' }) lastTradeAt!: string;
}

export class TradeTrendBucket {
  @ApiProperty({ format: 'date-time', description: 'Start of the bucket, UTC, inclusive' })
  bucketStart!: string;
  @ApiProperty({ example: 5, description: 'Trades created in the bucket, whatever their outcome' })
  trades!: number;
  @ApiProperty({ example: 5 }) completed!: number;
  @ApiProperty({ ...ENERGY, description: 'Energy of the completed trades' }) energyKwh!: string;
  @ApiProperty(MONEY) volume!: string;
  @ApiProperty(PRICE) averagePricePerKwh!: string | null;
}

export class TradeTrendResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ enum: TIME_BUCKETS }) bucket!: string;
  @ApiProperty({
    type: [TradeTrendBucket],
    description: 'Every bucket in the window, oldest first. A quiet bucket reports zeros.',
  })
  buckets!: TradeTrendBucket[];
}

export class HouseholdTradeStatsQuery extends IntersectionType(PaginationQuery, StatsRangeQuery) {
  @HouseholdIdFilter('Only this household, as buyer or as seller')
  householdId?: string;
}
