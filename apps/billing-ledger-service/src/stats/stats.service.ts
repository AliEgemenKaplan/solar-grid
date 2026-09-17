import { Injectable } from '@nestjs/common';
import { divideDecimal, PRICE_SCALE } from '@solar-grid/shared-utils';
import {
  bucketStarts,
  describeRange,
  energyOrZero,
  moneyOrZero,
  Page,
  pageWindow,
  priceOrNull,
  ResolvedRange,
  resolveStatsRange,
  resolveTrendWindow,
  StatsRangeQuery,
  StatsTrendQuery,
  toPage,
} from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/client';
import {
  BillingSummaryResponse,
  BillingTrendBucket,
  BillingTrendResponse,
  HouseholdBillingStatsQuery,
  HouseholdBillingStatsResponse,
} from './dto/billing-stats.dto';

type Numeric = Prisma.Decimal | null;

interface TradeRow {
  trades: number;
  energy: Numeric;
  volume: Numeric;
  avg_price: Numeric;
  min_price: Numeric;
  max_price: Numeric;
  currency: string | null;
}

interface LedgerRow {
  entries: number;
  credited: Numeric;
  debited: Numeric;
  households: number;
}

interface BalanceRow {
  households: number;
  in_credit: number;
  in_debit: number;
  settled: number;
  total_credit: Numeric;
  total_debit: Numeric;
}

interface HouseholdRow {
  household_id: string;
  entries: number;
  credits: number;
  debits: number;
  credited: Numeric;
  debited: Numeric;
  first_at: Date;
  last_at: Date;
}

interface BucketRow {
  bucket_start: Date;
  trades: number;
  energy: Numeric;
  volume: Numeric;
  avg_price: Numeric;
}

/**
 * Read-only statistics over the trades and the ledger this service owns.
 *
 * The ledger is append-only and stays that way: everything here is a SELECT,
 * run by the same least privileged role the rest of the service uses, which
 * may read and insert but never delete a ledger entry.
 *
 * Trades are counted by `completedAt`, when the trade actually happened,
 * rather than by when this service got around to recording it.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: StatsRangeQuery): Promise<BillingSummaryResponse> {
    const range = resolveStatsRange(query);

    const [[trades], [{ households }], [ledger], [balances]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<TradeRow[]>`
        SELECT
          COUNT(*)::int AS trades,
          COALESCE(SUM("energyKwh"), 0) AS energy,
          COALESCE(SUM("totalAmount"), 0) AS volume,
          AVG("pricePerKwh") AS avg_price,
          MIN("pricePerKwh") AS min_price,
          MAX("pricePerKwh") AS max_price,
          MIN(currency) AS currency
        FROM completed_trades
        WHERE ${completedWindow(range)}`,
      this.prisma.$queryRaw<{ households: number }[]>`
        SELECT COUNT(*)::int AS households FROM (
          SELECT "sellerHouseholdId" AS household FROM completed_trades
          WHERE ${completedWindow(range)}
          UNION
          SELECT "buyerHouseholdId" FROM completed_trades WHERE ${completedWindow(range)}
        ) AS parties`,
      this.prisma.$queryRaw<LedgerRow[]>`
        SELECT
          COUNT(*)::int AS entries,
          COALESCE(SUM(amount) FILTER (WHERE "entryType" = 'CREDIT'), 0) AS credited,
          COALESCE(SUM(amount) FILTER (WHERE "entryType" = 'DEBIT'), 0) AS debited,
          COUNT(DISTINCT "householdId")::int AS households
        FROM ledger_entries
        WHERE ${createdWindow(range)}`,
      // Balances are a running total, so they are as they stand now whatever
      // window was asked for.
      this.prisma.$queryRaw<BalanceRow[]>`
        SELECT
          COUNT(*)::int AS households,
          (COUNT(*) FILTER (WHERE balance > 0))::int AS in_credit,
          (COUNT(*) FILTER (WHERE balance < 0))::int AS in_debit,
          (COUNT(*) FILTER (WHERE balance = 0))::int AS settled,
          COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) AS total_credit,
          COALESCE(ABS(SUM(balance) FILTER (WHERE balance < 0)), 0) AS total_debit
        FROM household_balances`,
    ]);

    return {
      range: describeRange(range),
      currency: trades.currency ?? 'TRY',
      trades: {
        trades: trades.trades,
        energyKwh: energyOrZero(trades.energy),
        volume: moneyOrZero(trades.volume),
        averagePricePerKwh: priceOrNull(trades.avg_price),
        volumeWeightedPricePerKwh: divideDecimal(
          trades.volume ?? 0,
          trades.energy ?? 0,
          PRICE_SCALE,
        ),
        minPricePerKwh: priceOrNull(trades.min_price),
        maxPricePerKwh: priceOrNull(trades.max_price),
        households,
      },
      ledger: {
        entries: ledger.entries,
        credited: moneyOrZero(ledger.credited),
        debited: moneyOrZero(ledger.debited),
        net: moneyOrZero(
          new Prisma.Decimal(ledger.credited ?? 0).minus(new Prisma.Decimal(ledger.debited ?? 0)),
        ),
        households: ledger.households,
      },
      balances: {
        households: balances.households,
        inCredit: balances.in_credit,
        inDebit: balances.in_debit,
        settled: balances.settled,
        totalCredit: moneyOrZero(balances.total_credit),
        totalDebit: moneyOrZero(balances.total_debit),
      },
    };
  }

  /** One row per household with ledger entries in the window, busiest first. */
  async households(
    query: HouseholdBillingStatsQuery,
  ): Promise<Page<HouseholdBillingStatsResponse>> {
    const range = resolveStatsRange(query);
    const household = query.householdId
      ? Prisma.sql`AND "householdId" = ${query.householdId}`
      : Prisma.empty;
    const { skip, take } = pageWindow(query);

    const [rows, [{ total }]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<HouseholdRow[]>`
        SELECT "householdId" AS household_id,
               COUNT(*)::int AS entries,
               (COUNT(*) FILTER (WHERE "entryType" = 'CREDIT'))::int AS credits,
               (COUNT(*) FILTER (WHERE "entryType" = 'DEBIT'))::int AS debits,
               COALESCE(SUM(amount) FILTER (WHERE "entryType" = 'CREDIT'), 0) AS credited,
               COALESCE(SUM(amount) FILTER (WHERE "entryType" = 'DEBIT'), 0) AS debited,
               MIN("createdAt") AS first_at,
               MAX("createdAt") AS last_at
        FROM ledger_entries
        WHERE ${createdWindow(range)} ${household}
        GROUP BY "householdId"
        ORDER BY SUM(amount) DESC, "householdId" ASC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(DISTINCT "householdId")::int AS total
        FROM ledger_entries
        WHERE ${createdWindow(range)} ${household}`,
    ]);

    return toPage(
      rows.map((row) => ({
        householdId: row.household_id,
        entries: row.entries,
        credits: row.credits,
        debits: row.debits,
        credited: moneyOrZero(row.credited),
        debited: moneyOrZero(row.debited),
        net: moneyOrZero(
          new Prisma.Decimal(row.credited ?? 0).minus(new Prisma.Decimal(row.debited ?? 0)),
        ),
        firstEntryAt: row.first_at.toISOString(),
        lastEntryAt: row.last_at.toISOString(),
      })),
      total,
      query,
    );
  }

  async trend(query: StatsTrendQuery): Promise<BillingTrendResponse> {
    const { from, to, bucket } = resolveTrendWindow(query);
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT date_trunc(CAST(${bucket} AS text), "completedAt") AS bucket_start,
             COUNT(*)::int AS trades,
             COALESCE(SUM("energyKwh"), 0) AS energy,
             COALESCE(SUM("totalAmount"), 0) AS volume,
             AVG("pricePerKwh") AS avg_price
      FROM completed_trades
      WHERE "completedAt" >= CAST(${from.toISOString()} AS timestamp)
        AND "completedAt" < CAST(${to.toISOString()} AS timestamp)
      GROUP BY 1
      ORDER BY 1`;

    const byBucket = new Map(rows.map((row) => [row.bucket_start.getTime(), row]));
    const buckets: BillingTrendBucket[] = bucketStarts(from, to, bucket).map((start) => {
      const row = byBucket.get(start.getTime());
      return {
        bucketStart: start.toISOString(),
        trades: row?.trades ?? 0,
        energyKwh: energyOrZero(row?.energy),
        volume: moneyOrZero(row?.volume),
        averagePricePerKwh: priceOrNull(row?.avg_price),
      };
    });

    return { range: { from: from.toISOString(), to: to.toISOString() }, bucket, buckets };
  }
}

/**
 * Bounds are sent as text and cast to `timestamp`, which is what the columns
 * are: the comparison then means the same thing whatever time zone the
 * database session or the Node process happens to be in.
 */
function completedWindow(range: ResolvedRange): Prisma.Sql {
  return boundedBy(Prisma.sql`"completedAt"`, range);
}

function createdWindow(range: ResolvedRange): Prisma.Sql {
  return boundedBy(Prisma.sql`"createdAt"`, range);
}

function boundedBy(column: Prisma.Sql, range: ResolvedRange): Prisma.Sql {
  return Prisma.sql`TRUE
    ${
      range.from
        ? Prisma.sql`AND ${column} >= CAST(${range.from.toISOString()} AS timestamp)`
        : Prisma.empty
    }
    ${
      range.to
        ? Prisma.sql`AND ${column} < CAST(${range.to.toISOString()} AS timestamp)`
        : Prisma.empty
    }`;
}
