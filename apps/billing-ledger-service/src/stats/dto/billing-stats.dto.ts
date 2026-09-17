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
  description: 'Null when no trade was settled in the window',
} as const;

/**
 * Settled trades. Billing records a trade and writes its ledger entries in
 * one transaction, so "billed" and "settled" are the same moment here and
 * there is no separate settlement step to count.
 */
export class SettledTradeStats {
  @ApiProperty({ example: 40 }) trades!: number;
  @ApiProperty(ENERGY) energyKwh!: string;
  @ApiProperty({ ...MONEY, description: 'Total billed, which is also total settled' })
  volume!: string;
  @ApiProperty(PRICE) averagePricePerKwh!: string | null;
  @ApiProperty({ ...PRICE, description: 'Volume divided by energy' })
  volumeWeightedPricePerKwh!: string | null;
  @ApiProperty(PRICE) minPricePerKwh!: string | null;
  @ApiProperty(PRICE) maxPricePerKwh!: string | null;
  @ApiProperty({ example: 12, description: 'Households on either side of a settled trade' })
  households!: number;
}

/**
 * The append-only ledger. Every trade writes one credit and one debit for the
 * same amount, so `net` is zero in a healthy ledger: anything else means
 * entries are missing or unbalanced.
 */
export class LedgerStats {
  @ApiProperty({ example: 80 }) entries!: number;
  @ApiProperty({ ...MONEY, description: 'Credited to sellers' }) credited!: string;
  @ApiProperty({ ...MONEY, description: 'Debited from buyers' }) debited!: string;
  @ApiProperty({ ...MONEY, description: 'Credits minus debits, "0.00" when the ledger balances' })
  net!: string;
  @ApiProperty({ example: 12 }) households!: number;
}

/** Balances as they stand now. The window does not apply to them. */
export class BalanceStats {
  @ApiProperty({ example: 12 }) households!: number;
  @ApiProperty({ example: 5, description: 'Households in credit' }) inCredit!: number;
  @ApiProperty({ example: 6, description: 'Households in debit' }) inDebit!: number;
  @ApiProperty({ example: 1 }) settled!: number;
  @ApiProperty({ ...MONEY, description: 'Owed to households in credit' }) totalCredit!: string;
  @ApiProperty({ ...MONEY, description: 'Owed by households in debit' }) totalDebit!: string;
}

export class BillingSummaryResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty({ type: SettledTradeStats }) trades!: SettledTradeStats;
  @ApiProperty({ type: LedgerStats }) ledger!: LedgerStats;
  @ApiProperty({ type: BalanceStats, description: 'Current balances; the window does not apply' })
  balances!: BalanceStats;
}

/** One household's ledger activity. */
export class HouseholdBillingStatsResponse {
  @ApiProperty({ example: 'HH-SELLER-001' }) householdId!: string;
  @ApiProperty({ example: 8, description: 'Ledger entries, one per trade this household was in' })
  entries!: number;
  @ApiProperty({ example: 6 }) credits!: number;
  @ApiProperty({ example: 2 }) debits!: number;
  @ApiProperty(MONEY) credited!: string;
  @ApiProperty(MONEY) debited!: string;
  @ApiProperty({ ...MONEY, description: 'Credits minus debits over the window' }) net!: string;
  @ApiProperty({ format: 'date-time' }) firstEntryAt!: string;
  @ApiProperty({ format: 'date-time' }) lastEntryAt!: string;
}

export class BillingTrendBucket {
  @ApiProperty({ format: 'date-time', description: 'Start of the bucket, UTC, inclusive' })
  bucketStart!: string;
  @ApiProperty({ example: 5 }) trades!: number;
  @ApiProperty(ENERGY) energyKwh!: string;
  @ApiProperty(MONEY) volume!: string;
  @ApiProperty(PRICE) averagePricePerKwh!: string | null;
}

export class BillingTrendResponse {
  @ApiProperty({ type: StatsRangeResponse }) range!: StatsRangeResponse;
  @ApiProperty({ enum: TIME_BUCKETS }) bucket!: string;
  @ApiProperty({
    type: [BillingTrendBucket],
    description: 'Every bucket in the window, oldest first. A quiet bucket reports zeros.',
  })
  buckets!: BillingTrendBucket[];
}

export class HouseholdBillingStatsQuery extends IntersectionType(PaginationQuery, StatsRangeQuery) {
  @HouseholdIdFilter('Only this household')
  householdId?: string;
}
