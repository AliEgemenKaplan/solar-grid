import { Injectable } from '@nestjs/common';
import { formatEnergy, formatPrice } from '@solar-grid/shared-utils';
import {
  bucketStarts,
  describeRange,
  energyOrZero,
  priceOrNull,
  ResolvedRange,
  resolveStatsRange,
  resolveTrendWindow,
  StatsRangeQuery,
  StatsTrendQuery,
} from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/client';
import { PriceSummaryResponse, PriceTrendBucket, PriceTrendResponse } from './dto/price-stats.dto';

type Numeric = Prisma.Decimal | null;

interface PriceRow {
  snapshots: number;
  avg_price: Numeric;
  min_price: Numeric;
  max_price: Numeric;
  avg_supply: Numeric;
  avg_demand: Numeric;
}

interface BucketRow extends PriceRow {
  bucket_start: Date;
}

/**
 * Read-only statistics over the price snapshots this service records.
 *
 * Prices are a decimal column and the averages are taken by Postgres; the
 * service rounds the result once, to the scale prices are stored at.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: StatsRangeQuery): Promise<PriceSummaryResponse> {
    const range = resolveStatsRange(query);
    const within = {
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lt: range.to } : {}),
            },
          }
        : {}),
    };

    const [[row], latest, rule] = await this.prisma.$transaction([
      this.prisma.$queryRaw<PriceRow[]>`
        SELECT ${PRICE_AGGREGATES}
        FROM price_snapshots
        WHERE ${window(range)}`,
      this.prisma.priceSnapshot.findFirst({
        where: within,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.pricingRule.findFirst({ where: { isActive: true } }),
    ]);

    return {
      range: describeRange(range),
      ...priceFields(row),
      latest: latest && {
        pricePerKwh: formatPrice(latest.calculatedPrice),
        supplyKwh: formatEnergy(latest.totalSupplyKwh),
        demandKwh: formatEnergy(latest.totalDemandKwh),
        calculatedAt: latest.createdAt.toISOString(),
      },
      band: rule && {
        basePrice: formatPrice(rule.basePrice),
        minPrice: formatPrice(rule.minPrice),
        maxPrice: formatPrice(rule.maxPrice),
        currency: rule.currency,
      },
    };
  }

  async trend(query: StatsTrendQuery): Promise<PriceTrendResponse> {
    const { from, to, bucket } = resolveTrendWindow(query);
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT date_trunc(CAST(${bucket} AS text), "createdAt") AS bucket_start, ${PRICE_AGGREGATES}
      FROM price_snapshots
      WHERE "createdAt" >= CAST(${from.toISOString()} AS timestamp)
        AND "createdAt" < CAST(${to.toISOString()} AS timestamp)
      GROUP BY 1
      ORDER BY 1`;

    const byBucket = new Map(rows.map((row) => [row.bucket_start.getTime(), row]));
    const buckets: PriceTrendBucket[] = bucketStarts(from, to, bucket).map((start) => {
      const row = byBucket.get(start.getTime());
      return {
        bucketStart: start.toISOString(),
        ...priceFields(row),
      };
    });

    return { range: { from: from.toISOString(), to: to.toISOString() }, bucket, buckets };
  }
}

const PRICE_AGGREGATES = Prisma.sql`
  COUNT(*)::int AS snapshots,
  AVG("calculatedPrice") AS avg_price,
  MIN("calculatedPrice") AS min_price,
  MAX("calculatedPrice") AS max_price,
  AVG("totalSupplyKwh") AS avg_supply,
  AVG("totalDemandKwh") AS avg_demand`;

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

/**
 * A price nobody calculated is null rather than zero; supply and demand are
 * reported as zero, because an average over no snapshots is no energy.
 */
function priceFields(row: PriceRow | undefined) {
  return {
    snapshots: row?.snapshots ?? 0,
    averagePricePerKwh: priceOrNull(row?.avg_price),
    minPricePerKwh: priceOrNull(row?.min_price),
    maxPricePerKwh: priceOrNull(row?.max_price),
    averageSupplyKwh: energyOrZero(row?.avg_supply),
    averageDemandKwh: energyOrZero(row?.avg_demand),
  };
}
