/**
 * The shapes the Solar Grid services return, as documented in
 * docs/analytics.md and docs/api-contracts.md.
 *
 * Energy, money and prices are decimal strings at fixed scale ("15.000",
 * "65.00", "4.3333"). They stay strings in this app: the backend did the
 * arithmetic exactly, and the dashboard shows what it said. The only place
 * they become numbers is the pixel position of a chart mark.
 */

/** A decimal string such as "12.500". */
export type Decimal = string;
/** An ISO-8601 UTC instant such as "2026-05-27T10:00:00.000Z". */
export type Instant = string;

export type TimeBucket = 'hour' | 'day' | 'week';

export interface StatsRange {
  from: Instant | null;
  to: Instant | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// --- smart-meter -------------------------------------------------------------

export interface EnergySummary {
  range: StatsRange;
  readings: number;
  households: number;
  productionKwh: Decimal;
  consumptionKwh: Decimal;
  netKwh: Decimal;
  surplusKwh: Decimal;
  demandKwh: Decimal;
  firstReadingAt: Instant | null;
  lastReadingAt: Instant | null;
}

export interface HouseholdEnergy {
  householdId: string;
  readings: number;
  productionKwh: Decimal;
  consumptionKwh: Decimal;
  netKwh: Decimal;
  surplusKwh: Decimal;
  demandKwh: Decimal;
  firstReadingAt: Instant;
  lastReadingAt: Instant;
}

export interface EnergyTrendBucket {
  bucketStart: Instant;
  readings: number;
  households: number;
  productionKwh: Decimal;
  consumptionKwh: Decimal;
  netKwh: Decimal;
}

// --- pricing -----------------------------------------------------------------

export interface PricingBand {
  basePrice: Decimal;
  minPrice: Decimal;
  maxPrice: Decimal;
  currency: string;
}

export interface PriceSummary {
  range: StatsRange;
  snapshots: number;
  averagePricePerKwh: Decimal | null;
  minPricePerKwh: Decimal | null;
  maxPricePerKwh: Decimal | null;
  averageSupplyKwh: Decimal;
  averageDemandKwh: Decimal;
  latest: {
    pricePerKwh: Decimal;
    supplyKwh: Decimal;
    demandKwh: Decimal;
    calculatedAt: Instant;
  } | null;
  band: PricingBand | null;
}

export interface PriceTrendBucket {
  bucketStart: Instant;
  snapshots: number;
  averagePricePerKwh: Decimal | null;
  minPricePerKwh: Decimal | null;
  maxPricePerKwh: Decimal | null;
  averageSupplyKwh: Decimal;
  averageDemandKwh: Decimal;
}

/** GET /prices/current, public. */
export interface CurrentPrice {
  pricePerKwh: Decimal;
  currency: string;
  calculatedAt: Instant;
  supplyKwh: Decimal;
  demandKwh: Decimal;
}

// --- trade-matching ----------------------------------------------------------

export interface BookStats {
  total: number;
  open: number;
  partiallyMatched: number;
  matched: number;
  cancelled: number;
  totalKwh: Decimal;
  matchedKwh: Decimal;
  openKwh: Decimal;
}

export interface TradeSummary {
  range: StatsRange;
  currency: string;
  households: number;
  trades: { total: number; completed: number; pendingBilling: number; failed: number };
  completed: {
    energyKwh: Decimal;
    volume: Decimal;
    averagePricePerKwh: Decimal | null;
    volumeWeightedPricePerKwh: Decimal | null;
    minPricePerKwh: Decimal | null;
    maxPricePerKwh: Decimal | null;
  };
  pending: { energyKwh: Decimal; volume: Decimal };
  offers: BookStats;
  requests: BookStats;
}

export interface HouseholdTrading {
  householdId: string;
  tradesAsSeller: number;
  tradesAsBuyer: number;
  soldKwh: Decimal;
  boughtKwh: Decimal;
  sellVolume: Decimal;
  buyVolume: Decimal;
  netVolume: Decimal;
  lastTradeAt: Instant;
}

export interface TradeTrendBucket {
  bucketStart: Instant;
  trades: number;
  completed: number;
  energyKwh: Decimal;
  volume: Decimal;
  averagePricePerKwh: Decimal | null;
}

// --- billing -----------------------------------------------------------------

export interface BillingSummary {
  range: StatsRange;
  currency: string;
  trades: {
    trades: number;
    energyKwh: Decimal;
    volume: Decimal;
    averagePricePerKwh: Decimal | null;
    volumeWeightedPricePerKwh: Decimal | null;
    minPricePerKwh: Decimal | null;
    maxPricePerKwh: Decimal | null;
    households: number;
  };
  ledger: {
    entries: number;
    credited: Decimal;
    debited: Decimal;
    net: Decimal;
    households: number;
  };
  /** As they stand now; the window does not apply. */
  balances: {
    households: number;
    inCredit: number;
    inDebit: number;
    settled: number;
    totalCredit: Decimal;
    totalDebit: Decimal;
  };
}

export interface HouseholdBilling {
  householdId: string;
  entries: number;
  credits: number;
  debits: number;
  credited: Decimal;
  debited: Decimal;
  net: Decimal;
  firstEntryAt: Instant;
  lastEntryAt: Instant;
}

export interface BillingTrendBucket {
  bucketStart: Instant;
  trades: number;
  energyKwh: Decimal;
  volume: Decimal;
  averagePricePerKwh: Decimal | null;
}

// --- common ------------------------------------------------------------------

export interface Trend<B> {
  range: StatsRange;
  bucket: TimeBucket;
  buckets: B[];
}

export type ReadinessStatus = 'ready' | 'not_ready' | 'shutting_down';

/** GET /health/ready, public: status and dependency names, never error text. */
export interface ReadinessReport {
  status: ReadinessStatus;
  service: string;
  timestamp: Instant;
  checks: Record<string, { status: 'up' | 'down'; critical: boolean; durationMs: number }>;
}

/** The error body every service returns. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  correlationId: string;
  timestamp: string;
  path: string;
  details?: string[];
}

// --- diagnostics ---------------------------------------------------------------

/** One series of a service counter. For a histogram, `value` is the count and `sum` the total. */
export interface DiagnosticSeries {
  labels: Record<string, string>;
  value: number;
  sum?: number;
}

export interface DiagnosticMetric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  series: DiagnosticSeries[];
}

/** GET /diagnostics, operator only: a service's own counters since it started. */
export interface DiagnosticsSnapshot {
  service: string;
  countingSince: Instant;
  generatedAt: Instant;
  metrics: DiagnosticMetric[];
}

// --- single household, public ------------------------------------------------

/** GET /households/:id/status on smart-meter: the household's latest reading. */
export interface HouseholdStatus {
  householdId: string;
  currentStatus: 'SURPLUS' | 'DEMAND' | 'BALANCED';
  currentSurplusKwh: Decimal;
  currentDemandKwh: Decimal;
  lastReadingAt: Instant;
  updatedAt: Instant;
}

/** GET /balances/:id on billing: zero with no update time when it never traded. */
export interface HouseholdBalance {
  householdId: string;
  balance: Decimal;
  currency: string;
  updatedAt: Instant | null;
}
