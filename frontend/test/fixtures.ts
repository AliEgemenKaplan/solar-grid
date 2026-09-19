import { vi } from 'vitest';
import type { DashboardConfig } from '../src/config/config';
import type { ApiResponse } from '../src/services/api-client';
import { ApiError, type ApiErrorKind } from '../src/services/api-error';
import type { SolarGridApi } from '../src/services/solar-grid-api';
import type {
  BillingSummary,
  CurrentPrice,
  EnergySummary,
  EnergyTrendBucket,
  HouseholdBilling,
  HouseholdEnergy,
  HouseholdTrading,
  Page,
  PriceSummary,
  PriceTrendBucket,
  ReadinessReport,
  TradeSummary,
  TradeTrendBucket,
  Trend,
} from '../src/types/api';

/**
 * Shapes exactly as the services return them (docs/analytics.md), so a test
 * that passes here exercises the contract the real stack speaks. None of this
 * ships in the app: it exists only inside the tests.
 */

export const TEST_CONFIG: DashboardConfig = {
  apiUrls: {
    smartMeter: 'http://meter.test',
    pricing: 'http://pricing.test',
    tradeMatching: 'http://trading.test',
    billing: 'http://billing.test',
  },
  requestTimeoutMs: 5_000,
  autoRefreshMs: 30_000,
};

export function ok<T>(data: T, correlationId = 'test-correlation'): ApiResponse<T> {
  return { data, correlationId, status: 200, durationMs: 12 };
}

export function apiError(kind: ApiErrorKind, message = `failed: ${kind}`): ApiError {
  return new ApiError(kind, message, {
    service: 'tradeMatching',
    correlationId: 'dashboard-failed-request',
  });
}

const RANGE = { from: '2026-09-18T12:00:00.000Z', to: '2026-09-19T12:00:00.000Z' };

export const energySummary: EnergySummary = {
  range: RANGE,
  readings: 240,
  households: 12,
  productionKwh: '1234.500',
  consumptionKwh: '987.250',
  netKwh: '247.250',
  surplusKwh: '400.000',
  demandKwh: '152.750',
  firstReadingAt: '2026-09-18T12:05:00.000Z',
  lastReadingAt: '2026-09-19T11:55:00.000Z',
};

export const energyTrend: Trend<EnergyTrendBucket> = {
  range: RANGE,
  bucket: 'hour',
  buckets: [
    {
      bucketStart: '2026-09-19T09:00:00.000Z',
      readings: 2,
      households: 2,
      productionKwh: '13.000',
      consumptionKwh: '7.000',
      netKwh: '6.000',
    },
    {
      bucketStart: '2026-09-19T10:00:00.000Z',
      readings: 0,
      households: 0,
      productionKwh: '0.000',
      consumptionKwh: '0.000',
      netKwh: '0.000',
    },
    {
      bucketStart: '2026-09-19T11:00:00.000Z',
      readings: 1,
      households: 1,
      productionKwh: '1.000',
      consumptionKwh: '5.000',
      netKwh: '-4.000',
    },
  ],
};

export const tradeSummary: TradeSummary = {
  range: RANGE,
  currency: 'TRY',
  households: 4,
  trades: { total: 4, completed: 2, pendingBilling: 1, failed: 1 },
  completed: {
    energyKwh: '15.000',
    volume: '65.00',
    averagePricePerKwh: '4.5000',
    volumeWeightedPricePerKwh: '4.3333',
    minPricePerKwh: '4.0000',
    maxPricePerKwh: '5.0000',
  },
  pending: { energyKwh: '2.000', volume: '6.00' },
  offers: {
    total: 4,
    open: 1,
    partiallyMatched: 2,
    matched: 1,
    cancelled: 0,
    totalKwh: '27.000',
    matchedKwh: '17.000',
    openKwh: '10.000',
  },
  requests: {
    total: 2,
    open: 0,
    partiallyMatched: 1,
    matched: 1,
    cancelled: 0,
    totalKwh: '16.000',
    matchedKwh: '15.000',
    openKwh: '1.000',
  },
};

export const tradeTrend: Trend<TradeTrendBucket> = {
  range: RANGE,
  bucket: 'hour',
  buckets: [
    {
      bucketStart: '2026-09-19T09:00:00.000Z',
      trades: 1,
      completed: 1,
      energyKwh: '10.000',
      volume: '40.00',
      averagePricePerKwh: '4.0000',
    },
    {
      bucketStart: '2026-09-19T10:00:00.000Z',
      trades: 0,
      completed: 0,
      energyKwh: '0.000',
      volume: '0.00',
      averagePricePerKwh: null,
    },
    {
      bucketStart: '2026-09-19T11:00:00.000Z',
      trades: 1,
      completed: 1,
      energyKwh: '5.000',
      volume: '25.00',
      averagePricePerKwh: '5.0000',
    },
  ],
};

export const priceSummary: PriceSummary = {
  range: RANGE,
  snapshots: 3,
  averagePricePerKwh: '4.0000',
  minPricePerKwh: '2.0000',
  maxPricePerKwh: '6.0000',
  averageSupplyKwh: '40.000',
  averageDemandKwh: '43.333',
  latest: {
    pricePerKwh: '6.0000',
    supplyKwh: '30.000',
    demandKwh: '60.000',
    calculatedAt: '2026-09-19T11:00:00.000Z',
  },
  band: { basePrice: '4.0000', minPrice: '2.5000', maxPrice: '7.0000', currency: 'TRY' },
};

export const priceTrend: Trend<PriceTrendBucket> = {
  range: RANGE,
  bucket: 'hour',
  buckets: [
    {
      bucketStart: '2026-09-19T09:00:00.000Z',
      snapshots: 2,
      averagePricePerKwh: '3.0000',
      minPricePerKwh: '2.0000',
      maxPricePerKwh: '4.0000',
      averageSupplyKwh: '45.000',
      averageDemandKwh: '35.000',
    },
    {
      bucketStart: '2026-09-19T10:00:00.000Z',
      snapshots: 0,
      averagePricePerKwh: null,
      minPricePerKwh: null,
      maxPricePerKwh: null,
      averageSupplyKwh: '0.000',
      averageDemandKwh: '0.000',
    },
    {
      bucketStart: '2026-09-19T11:00:00.000Z',
      snapshots: 1,
      averagePricePerKwh: '6.0000',
      minPricePerKwh: '6.0000',
      maxPricePerKwh: '6.0000',
      averageSupplyKwh: '30.000',
      averageDemandKwh: '60.000',
    },
  ],
};

export const currentPrice: CurrentPrice = {
  pricePerKwh: '6.0000',
  currency: 'TRY',
  calculatedAt: '2026-09-19T11:00:00.000Z',
  supplyKwh: '30.000',
  demandKwh: '60.000',
};

export const billingSummary: BillingSummary = {
  range: RANGE,
  currency: 'TRY',
  trades: {
    trades: 2,
    energyKwh: '15.000',
    volume: '65.00',
    averagePricePerKwh: '4.5000',
    volumeWeightedPricePerKwh: '4.3333',
    minPricePerKwh: '4.0000',
    maxPricePerKwh: '5.0000',
    households: 3,
  },
  ledger: { entries: 4, credited: '65.00', debited: '65.00', net: '0.00', households: 3 },
  balances: {
    households: 4,
    inCredit: 2,
    inDebit: 1,
    settled: 1,
    totalCredit: '65.00',
    totalDebit: '65.00',
  },
};

export function page<T>(items: T[], total = items.length, pageNumber = 1, limit = 10): Page<T> {
  return { items, page: pageNumber, limit, total };
}

export const tradingHouseholds: HouseholdTrading[] = [
  {
    householdId: 'HH-A',
    tradesAsSeller: 1,
    tradesAsBuyer: 0,
    soldKwh: '10.000',
    boughtKwh: '0.000',
    sellVolume: '40.00',
    buyVolume: '0.00',
    netVolume: '40.00',
    lastTradeAt: '2026-09-19T09:30:00.000Z',
  },
  {
    householdId: 'HH-B',
    tradesAsSeller: 0,
    tradesAsBuyer: 1,
    soldKwh: '0.000',
    boughtKwh: '10.000',
    sellVolume: '0.00',
    buyVolume: '40.00',
    netVolume: '-40.00',
    lastTradeAt: '2026-09-19T09:30:00.000Z',
  },
];

export const energyHouseholds: HouseholdEnergy[] = [
  {
    householdId: 'HH-A',
    readings: 3,
    productionKwh: '13.000',
    consumptionKwh: '16.000',
    netKwh: '-3.000',
    surplusKwh: '6.000',
    demandKwh: '9.000',
    firstReadingAt: '2026-09-19T09:00:00.000Z',
    lastReadingAt: '2026-09-19T11:00:00.000Z',
  },
];

export const billingHouseholds: HouseholdBilling[] = [
  {
    householdId: 'HH-B',
    entries: 2,
    credits: 0,
    debits: 2,
    credited: '0.00',
    debited: '65.00',
    net: '-65.00',
    firstEntryAt: '2026-09-19T09:30:00.000Z',
    lastEntryAt: '2026-09-19T11:30:00.000Z',
  },
];

export function readiness(
  service: string,
  status: ReadinessReport['status'] = 'ready',
): ReadinessReport {
  return {
    status,
    service,
    timestamp: '2026-09-19T12:00:00.000Z',
    checks: {
      database: { status: status === 'ready' ? 'up' : 'down', critical: true, durationMs: 1 },
    },
  };
}

/** Every endpoint answering with the shapes above; override any of them per test. */
export function fakeApi(overrides: Partial<Record<keyof SolarGridApi, unknown>> = {}) {
  const api = {
    energySummary: vi.fn(async () => ok(energySummary)),
    energyTrend: vi.fn(async () => ok(energyTrend)),
    energyHouseholds: vi.fn(async () => ok(page(energyHouseholds))),
    priceSummary: vi.fn(async () => ok(priceSummary)),
    priceTrend: vi.fn(async () => ok(priceTrend)),
    currentPrice: vi.fn(async () => ok(currentPrice)),
    tradeSummary: vi.fn(async () => ok(tradeSummary)),
    tradeTrend: vi.fn(async () => ok(tradeTrend)),
    tradeHouseholds: vi.fn(async () => ok(page(tradingHouseholds))),
    billingSummary: vi.fn(async () => ok(billingSummary)),
    billingTrend: vi.fn(async () => ok({ range: RANGE, bucket: 'hour', buckets: [] })),
    billingHouseholds: vi.fn(async () => ok(page(billingHouseholds))),
    readiness: vi.fn(async (service: string) => ({
      report: readiness(service),
      httpStatus: 200,
      latencyMs: 7,
      error: null,
    })),
    verifyOperatorToken: vi.fn(async () => ok({})),
    ...overrides,
  };
  return api as unknown as SolarGridApi & Record<keyof SolarGridApi, ReturnType<typeof vi.fn>>;
}
