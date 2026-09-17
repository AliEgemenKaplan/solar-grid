import { Injectable } from '@nestjs/common';
import {
  bucketStarts,
  describeRange,
  energyOrZero,
  isoOrNull,
  Page,
  pageWindow,
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
  EnergySummaryResponse,
  EnergyTrendBucket,
  EnergyTrendResponse,
  HouseholdEnergyStatsQuery,
  HouseholdEnergyStatsResponse,
} from './dto/energy-stats.dto';

type Numeric = Prisma.Decimal | null;

interface EnergyRow {
  readings: number;
  households: number;
  production: Numeric;
  consumption: Numeric;
  net: Numeric;
  surplus: Numeric;
  demand: Numeric;
  first_at: Date | null;
  last_at: Date | null;
}

interface HouseholdRow extends EnergyRow {
  household_id: string;
}

interface BucketRow extends EnergyRow {
  bucket_start: Date;
}

/**
 * Read-only statistics over the meter readings this service owns.
 *
 * Every figure is produced by one SQL aggregate: Postgres sums the exact
 * numeric columns and Node only formats the result. Nothing here loads rows
 * to add them up, and nothing here writes.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: StatsRangeQuery): Promise<EnergySummaryResponse> {
    const range = resolveStatsRange(query);
    const [row] = await this.prisma.$queryRaw<EnergyRow[]>`
      SELECT ${ENERGY_AGGREGATES}
      FROM meter_readings
      WHERE ${window(range)}`;

    return { range: describeRange(range), ...energyFields(row) };
  }

  /**
   * One row per household, biggest producer first. The window selects which
   * readings count; a household with none in it does not appear at all.
   */
  async households(query: HouseholdEnergyStatsQuery): Promise<Page<HouseholdEnergyStatsResponse>> {
    const range = resolveStatsRange(query);
    const household = query.householdId
      ? Prisma.sql`AND "householdId" = ${query.householdId}`
      : Prisma.empty;
    const { skip, take } = pageWindow(query);

    const [rows, [{ total }]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<HouseholdRow[]>`
        SELECT "householdId" AS household_id, ${ENERGY_AGGREGATES}
        FROM meter_readings
        WHERE ${window(range)} ${household}
        GROUP BY "householdId"
        ORDER BY COALESCE(SUM("productionKwh"), 0) DESC, "householdId" ASC
        LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(DISTINCT "householdId")::int AS total
        FROM meter_readings
        WHERE ${window(range)} ${household}`,
    ]);

    return toPage(
      rows.map((row) => {
        // "households" is one by construction in a grouped row, and a grouped
        // row exists because it has readings, so the timestamps are never null.
        const { households: _one, ...fields } = energyFields(row);
        return {
          householdId: row.household_id,
          ...fields,
          firstReadingAt: row.first_at!.toISOString(),
          lastReadingAt: row.last_at!.toISOString(),
        };
      }),
      total,
      query,
    );
  }

  /**
   * A continuous series: Postgres groups the readings it has, and the buckets
   * it has nothing for are filled in here as zeros so a chart can draw the
   * quiet hours instead of skipping them.
   */
  async trend(query: StatsTrendQuery): Promise<EnergyTrendResponse> {
    const { from, to, bucket } = resolveTrendWindow(query);
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT date_trunc(CAST(${bucket} AS text), "timestamp") AS bucket_start, ${ENERGY_AGGREGATES}
      FROM meter_readings
      WHERE "timestamp" >= CAST(${from.toISOString()} AS timestamp)
        AND "timestamp" < CAST(${to.toISOString()} AS timestamp)
      GROUP BY 1
      ORDER BY 1`;

    const byBucket = new Map(rows.map((row) => [row.bucket_start.getTime(), row]));
    const buckets: EnergyTrendBucket[] = bucketStarts(from, to, bucket).map((start) => {
      const row = byBucket.get(start.getTime());
      return {
        bucketStart: start.toISOString(),
        readings: row?.readings ?? 0,
        households: row?.households ?? 0,
        productionKwh: energyOrZero(row?.production),
        consumptionKwh: energyOrZero(row?.consumption),
        netKwh: energyOrZero(row?.net),
      };
    });

    return { range: { from: from.toISOString(), to: to.toISOString() }, bucket, buckets };
  }
}

/**
 * The same figures wherever readings are aggregated. Surplus and demand are
 * the positive and negative halves of the net, counted separately: adding
 * them together would cancel a neighbourhood that both needs and offers
 * energy down to nothing.
 */
const ENERGY_AGGREGATES = Prisma.sql`
  COUNT(*)::int AS readings,
  COUNT(DISTINCT "householdId")::int AS households,
  COALESCE(SUM("productionKwh"), 0) AS production,
  COALESCE(SUM("consumptionKwh"), 0) AS consumption,
  COALESCE(SUM("netKwh"), 0) AS net,
  COALESCE(SUM("netKwh") FILTER (WHERE "netKwh" > 0), 0) AS surplus,
  COALESCE(ABS(SUM("netKwh") FILTER (WHERE "netKwh" < 0)), 0) AS demand,
  MIN("timestamp") AS first_at,
  MAX("timestamp") AS last_at`;

/**
 * Bounds are sent as text and cast to `timestamp`, which is what the column
 * is: the comparison then means the same thing whatever time zone the
 * database session or the Node process happens to be in.
 */
function window(range: ResolvedRange): Prisma.Sql {
  return Prisma.sql`TRUE
    ${
      range.from
        ? Prisma.sql`AND "timestamp" >= CAST(${range.from.toISOString()} AS timestamp)`
        : Prisma.empty
    }
    ${
      range.to
        ? Prisma.sql`AND "timestamp" < CAST(${range.to.toISOString()} AS timestamp)`
        : Prisma.empty
    }`;
}

function energyFields(row: EnergyRow) {
  return {
    readings: row.readings,
    households: row.households,
    productionKwh: energyOrZero(row.production),
    consumptionKwh: energyOrZero(row.consumption),
    netKwh: energyOrZero(row.net),
    surplusKwh: energyOrZero(row.surplus),
    demandKwh: energyOrZero(row.demand),
    firstReadingAt: isoOrNull(row.first_at),
    lastReadingAt: isoOrNull(row.last_at),
  };
}
