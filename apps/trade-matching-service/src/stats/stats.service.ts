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
  BookStats,
  HouseholdTradeStatsQuery,
  HouseholdTradeStatsResponse,
  TradeSummaryResponse,
  TradeTrendBucket,
  TradeTrendResponse,
} from './dto/trade-stats.dto';

type Numeric = Prisma.Decimal | null;

interface TradeRow {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  completed_energy: Numeric;
  completed_volume: Numeric;
  avg_price: Numeric;
  min_price: Numeric;
  max_price: Numeric;
  pending_energy: Numeric;
  pending_volume: Numeric;
  currency: string | null;
}

interface BookRow {
  total: number;
  open: number;
  partially_matched: number;
  matched: number;
  cancelled: number;
  total_kwh: Numeric;
  matched_kwh: Numeric;
  open_kwh: Numeric;
}

interface HouseholdRow {
  household_id: string;
  trades_as_seller: number;
  trades_as_buyer: number;
  sold_kwh: Numeric;
  bought_kwh: Numeric;
  sell_volume: Numeric;
  buy_volume: Numeric;
  last_trade_at: Date;
}

interface BucketRow {
  bucket_start: Date;
  trades: number;
  completed: number;
  energy: Numeric;
  volume: Numeric;
  avg_price: Numeric;
}

/**
 * Read-only statistics over the market this service runs: what was offered,
 * what was wanted, what traded and at what price.
 *
 * Every figure comes back from one SQL aggregate over the exact numeric
 * columns. The only arithmetic done here is the volume weighted price, and
 * that is decimal division, not floating point.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: StatsRangeQuery): Promise<TradeSummaryResponse> {
    const range = resolveStatsRange(query);
    const where = window(range);

    const [[trades], [{ households }], [offers], [requests]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<TradeRow[]>`
        SELECT
          COUNT(*)::int AS total,
          (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
          (COUNT(*) FILTER (WHERE status = 'PENDING_BILLING'))::int AS pending,
          (COUNT(*) FILTER (WHERE status = 'FAILED'))::int AS failed,
          COALESCE(SUM("energyKwh") FILTER (WHERE status = 'COMPLETED'), 0) AS completed_energy,
          COALESCE(SUM("totalAmount") FILTER (WHERE status = 'COMPLETED'), 0) AS completed_volume,
          AVG("pricePerKwh") FILTER (WHERE status = 'COMPLETED') AS avg_price,
          MIN("pricePerKwh") FILTER (WHERE status = 'COMPLETED') AS min_price,
          MAX("pricePerKwh") FILTER (WHERE status = 'COMPLETED') AS max_price,
          COALESCE(SUM("energyKwh") FILTER (WHERE status = 'PENDING_BILLING'), 0) AS pending_energy,
          COALESCE(SUM("totalAmount") FILTER (WHERE status = 'PENDING_BILLING'), 0) AS pending_volume,
          MIN(currency) AS currency
        FROM trade_matches
        WHERE ${where}`,
      // A household counts once whether it sold, bought, or did both.
      this.prisma.$queryRaw<{ households: number }[]>`
        SELECT COUNT(*)::int AS households FROM (
          SELECT "sellerHouseholdId" AS household FROM trade_matches WHERE ${where}
          UNION
          SELECT "buyerHouseholdId" FROM trade_matches WHERE ${where}
        ) AS parties`,
      this.prisma.$queryRaw<BookRow[]>`
        SELECT ${bookAggregates(Prisma.sql`"availableKwh"`)}
        FROM sell_offers
        WHERE ${window(range)}`,
      this.prisma.$queryRaw<BookRow[]>`
        SELECT ${bookAggregates(Prisma.sql`"requestedKwh"`)}
        FROM buy_requests
        WHERE ${window(range)}`,
    ]);

    return {
      range: describeRange(range),
      currency: trades.currency ?? 'TRY',
      households,
      trades: {
        total: trades.total,
        completed: trades.completed,
        pendingBilling: trades.pending,
        failed: trades.failed,
      },
      completed: {
        energyKwh: energyOrZero(trades.completed_energy),
        volume: moneyOrZero(trades.completed_volume),
        averagePricePerKwh: priceOrNull(trades.avg_price),
        volumeWeightedPricePerKwh: divideDecimal(
          trades.completed_volume ?? 0,
          trades.completed_energy ?? 0,
          PRICE_SCALE,
        ),
        minPricePerKwh: priceOrNull(trades.min_price),
        maxPricePerKwh: priceOrNull(trades.max_price),
      },
      pending: {
        energyKwh: energyOrZero(trades.pending_energy),
        volume: moneyOrZero(trades.pending_volume),
      },
      offers: bookStats(offers),
      requests: bookStats(requests),
    };
  }

  /**
   * One row per household that completed a trade in the window, busiest by
   * money first. A trade has two sides, so each is counted once for the
   * seller and once for the buyer and the two halves are added up in SQL.
   */
  async households(query: HouseholdTradeStatsQuery): Promise<Page<HouseholdTradeStatsResponse>> {
    const range = resolveStatsRange(query);
    const seller = query.householdId
      ? Prisma.sql`AND "sellerHouseholdId" = ${query.householdId}`
      : Prisma.empty;
    const buyer = query.householdId
      ? Prisma.sql`AND "buyerHouseholdId" = ${query.householdId}`
      : Prisma.empty;
    const sides = Prisma.sql`
      SELECT "sellerHouseholdId" AS household, 1 AS as_seller, 0 AS as_buyer,
             "energyKwh" AS sold, 0::numeric AS bought,
             "totalAmount" AS sell_volume, 0::numeric AS buy_volume, "createdAt"
      FROM trade_matches
      WHERE status = 'COMPLETED' AND ${window(range)} ${seller}
      UNION ALL
      SELECT "buyerHouseholdId", 0, 1,
             0::numeric, "energyKwh",
             0::numeric, "totalAmount", "createdAt"
      FROM trade_matches
      WHERE status = 'COMPLETED' AND ${window(range)} ${buyer}`;
    const { skip, take } = pageWindow(query);

    const [rows, [{ total }]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<HouseholdRow[]>`
        SELECT household AS household_id,
               SUM(as_seller)::int AS trades_as_seller,
               SUM(as_buyer)::int AS trades_as_buyer,
               SUM(sold) AS sold_kwh,
               SUM(bought) AS bought_kwh,
               SUM(sell_volume) AS sell_volume,
               SUM(buy_volume) AS buy_volume,
               MAX("createdAt") AS last_trade_at
        FROM (${sides}) AS sides
        GROUP BY household
        ORDER BY SUM(sell_volume) + SUM(buy_volume) DESC, household ASC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(DISTINCT household)::int AS total FROM (${sides}) AS sides`,
    ]);

    return toPage(
      rows.map((row) => ({
        householdId: row.household_id,
        tradesAsSeller: row.trades_as_seller,
        tradesAsBuyer: row.trades_as_buyer,
        soldKwh: energyOrZero(row.sold_kwh),
        boughtKwh: energyOrZero(row.bought_kwh),
        sellVolume: moneyOrZero(row.sell_volume),
        buyVolume: moneyOrZero(row.buy_volume),
        netVolume: moneyOrZero(
          new Prisma.Decimal(row.sell_volume ?? 0).minus(new Prisma.Decimal(row.buy_volume ?? 0)),
        ),
        lastTradeAt: row.last_trade_at.toISOString(),
      })),
      total,
      query,
    );
  }

  async trend(query: StatsTrendQuery): Promise<TradeTrendResponse> {
    const { from, to, bucket } = resolveTrendWindow(query);
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT date_trunc(CAST(${bucket} AS text), "createdAt") AS bucket_start,
             COUNT(*)::int AS trades,
             (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
             COALESCE(SUM("energyKwh") FILTER (WHERE status = 'COMPLETED'), 0) AS energy,
             COALESCE(SUM("totalAmount") FILTER (WHERE status = 'COMPLETED'), 0) AS volume,
             AVG("pricePerKwh") FILTER (WHERE status = 'COMPLETED') AS avg_price
      FROM trade_matches
      WHERE "createdAt" >= CAST(${from.toISOString()} AS timestamp)
        AND "createdAt" < CAST(${to.toISOString()} AS timestamp)
      GROUP BY 1
      ORDER BY 1`;

    const byBucket = new Map(rows.map((row) => [row.bucket_start.getTime(), row]));
    const buckets: TradeTrendBucket[] = bucketStarts(from, to, bucket).map((start) => {
      const row = byBucket.get(start.getTime());
      return {
        bucketStart: start.toISOString(),
        trades: row?.trades ?? 0,
        completed: row?.completed ?? 0,
        energyKwh: energyOrZero(row?.energy),
        volume: moneyOrZero(row?.volume),
        averagePricePerKwh: priceOrNull(row?.avg_price),
      };
    });

    return { range: { from: from.toISOString(), to: to.toISOString() }, bucket, buckets };
  }
}

/**
 * Offers and requests are the same shape with a different name for the energy
 * still on the table, so the aggregates are written once and given the
 * column: `originalKwh` is what was opened with, the remainder is what is
 * left, and the difference is what traded.
 */
function bookAggregates(remaining: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    COUNT(*)::int AS total,
    (COUNT(*) FILTER (WHERE status = 'OPEN'))::int AS open,
    (COUNT(*) FILTER (WHERE status = 'PARTIALLY_MATCHED'))::int AS partially_matched,
    (COUNT(*) FILTER (WHERE status = 'MATCHED'))::int AS matched,
    (COUNT(*) FILTER (WHERE status = 'CANCELLED'))::int AS cancelled,
    COALESCE(SUM("originalKwh"), 0) AS total_kwh,
    COALESCE(SUM("originalKwh" - ${remaining}), 0) AS matched_kwh,
    COALESCE(SUM(${remaining}) FILTER (WHERE status IN ('OPEN', 'PARTIALLY_MATCHED')), 0) AS open_kwh`;
}

function bookStats(row: BookRow): BookStats {
  return {
    total: row.total,
    open: row.open,
    partiallyMatched: row.partially_matched,
    matched: row.matched,
    cancelled: row.cancelled,
    totalKwh: energyOrZero(row.total_kwh),
    matchedKwh: energyOrZero(row.matched_kwh),
    openKwh: energyOrZero(row.open_kwh),
  };
}

/**
 * Bounds are sent as text and cast to `timestamp`, which is what the column
 * is: the comparison then means the same thing whatever time zone the
 * database session or the Node process happens to be in.
 */
function window(range: ResolvedRange): Prisma.Sql {
  return Prisma.sql`TRUE
    ${
      range.from
        ? Prisma.sql`AND "createdAt" >= CAST(${range.from.toISOString()} AS timestamp)`
        : Prisma.empty
    }
    ${
      range.to
        ? Prisma.sql`AND "createdAt" < CAST(${range.to.toISOString()} AS timestamp)`
        : Prisma.empty
    }`;
}
