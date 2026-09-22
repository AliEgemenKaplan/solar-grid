import type {
  Decimal,
  EnergyTrendBucket,
  PriceTrendBucket,
  TimeBucket,
  TradeTrendBucket,
  Trend,
} from '../types/api';
import { toChartNumber } from './format';

/**
 * Trend buckets turned into chart rows.
 *
 * Every bucket the API returned becomes exactly one row, in order: a quiet
 * bucket is a row of zeros because the API says it was zero, and an average
 * with nothing to average stays null, which the charts draw as a gap rather
 * than joining the neighbours across it. Each row keeps the original bucket so
 * the tooltip and the table can show the exact decimal strings.
 */

export interface ChartRow<B> {
  /** Bucket start, ISO UTC; the x value. */
  t: string;
  bucket: TimeBucket;
  source: B;
}

export interface EnergyRow extends ChartRow<EnergyTrendBucket> {
  production: number;
  consumption: number;
  net: number;
}

export interface MarketRow extends ChartRow<TradeTrendBucket> {
  energy: number;
  volume: number;
  averagePrice: number | null;
}

export interface PriceRow extends ChartRow<PriceTrendBucket> {
  average: number | null;
  /** [lowest, highest] in the bucket, drawn as a floating bar; null when nothing was priced. */
  range: [number, number] | null;
}

const zeroIfMissing = (value: Decimal) => toChartNumber(value) ?? 0;

export function energyRows(trend: Trend<EnergyTrendBucket>): EnergyRow[] {
  return trend.buckets.map((bucket) => ({
    t: bucket.bucketStart,
    bucket: trend.bucket,
    source: bucket,
    production: zeroIfMissing(bucket.productionKwh),
    consumption: zeroIfMissing(bucket.consumptionKwh),
    net: zeroIfMissing(bucket.netKwh),
  }));
}

export function marketRows(trend: Trend<TradeTrendBucket>): MarketRow[] {
  return trend.buckets.map((bucket) => ({
    t: bucket.bucketStart,
    bucket: trend.bucket,
    source: bucket,
    energy: zeroIfMissing(bucket.energyKwh),
    volume: zeroIfMissing(bucket.volume),
    averagePrice: toChartNumber(bucket.averagePricePerKwh),
  }));
}

export function priceRows(trend: Trend<PriceTrendBucket>): PriceRow[] {
  return trend.buckets.map((bucket) => {
    const low = toChartNumber(bucket.minPricePerKwh);
    const high = toChartNumber(bucket.maxPricePerKwh);
    return {
      t: bucket.bucketStart,
      bucket: trend.bucket,
      source: bucket,
      average: toChartNumber(bucket.averagePricePerKwh),
      range: low !== null && high !== null ? [low, high] : null,
    };
  });
}

/** Whether a series has anything to draw, so an all-zero window reads as empty. */
export function hasActivity<B>(rows: ChartRow<B>[], isActive: (bucket: B) => boolean): boolean {
  return rows.some((row) => isActive(row.source));
}

/** One number per bucket for a single-series chart, with the string it came from. */
export interface ValueRow<B> extends ChartRow<B> {
  value: number | null;
}

export function valueRows<B extends { bucketStart: string }>(
  trend: Trend<B>,
  value: (bucket: B) => Decimal | number | null,
): ValueRow<B>[] {
  return trend.buckets.map((bucket) => {
    const raw = value(bucket);
    return {
      t: bucket.bucketStart,
      bucket: trend.bucket,
      source: bucket,
      value: typeof raw === 'number' ? raw : toChartNumber(raw),
    };
  });
}

/**
 * The supply and demand each price was calculated from, per bucket. A bucket
 * where no price was calculated has no inputs either: a gap, not zero.
 */
export interface PriceInputRow extends ChartRow<PriceTrendBucket> {
  supply: number | null;
  demand: number | null;
}

export function priceInputRows(trend: Trend<PriceTrendBucket>): PriceInputRow[] {
  return trend.buckets.map((bucket) => ({
    t: bucket.bucketStart,
    bucket: trend.bucket,
    source: bucket,
    supply: bucket.snapshots > 0 ? toChartNumber(bucket.averageSupplyKwh) : null,
    demand: bucket.snapshots > 0 ? toChartNumber(bucket.averageDemandKwh) : null,
  }));
}
