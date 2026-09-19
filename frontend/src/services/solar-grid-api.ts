import type { ServiceName } from '../config/config';
import type {
  BillingSummary,
  BillingTrendBucket,
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
  TimeBucket,
  TradeSummary,
  TradeTrendBucket,
  Trend,
} from '../types/api';
import { ApiError } from './api-error';
import type { ApiClient, ApiResponse } from './api-client';

/** A statistics window as the API takes it: UTC instants, `from` in, `to` out. */
export interface StatsWindow {
  from: string;
  to: string;
}

export interface HouseholdQuery extends StatsWindow {
  page: number;
  limit: number;
  householdId?: string;
}

/** A readiness answer, including the 503 a service gives when it is not ready. */
export interface ReadinessResult {
  report: ReadinessReport | null;
  httpStatus: number | null;
  latencyMs: number | null;
  error: ApiError | null;
}

/**
 * Every endpoint the dashboard reads, typed. Components and hooks call these
 * rather than building URLs, so the API surface the dashboard depends on is
 * visible in one file.
 */
export function createSolarGridApi(client: ApiClient) {
  const trend = (bucket: TimeBucket, window: StatsWindow) => ({ bucket, ...window });

  return {
    // smart-meter
    energySummary: (window: StatsWindow, signal?: AbortSignal) =>
      client.get<EnergySummary>('smartMeter', '/stats/summary', { query: { ...window }, signal }),
    energyTrend: (window: StatsWindow, bucket: TimeBucket, signal?: AbortSignal) =>
      client.get<Trend<EnergyTrendBucket>>('smartMeter', '/stats/trends', {
        query: trend(bucket, window),
        signal,
      }),
    energyHouseholds: (query: HouseholdQuery, signal?: AbortSignal) =>
      client.get<Page<HouseholdEnergy>>('smartMeter', '/stats/households', {
        query: { ...query },
        signal,
      }),

    // pricing
    priceSummary: (window: StatsWindow, signal?: AbortSignal) =>
      client.get<PriceSummary>('pricing', '/stats/summary', { query: { ...window }, signal }),
    priceTrend: (window: StatsWindow, bucket: TimeBucket, signal?: AbortSignal) =>
      client.get<Trend<PriceTrendBucket>>('pricing', '/stats/trends', {
        query: trend(bucket, window),
        signal,
      }),
    currentPrice: (signal?: AbortSignal) =>
      client.get<CurrentPrice>('pricing', '/prices/current', { authenticated: false, signal }),

    // trade-matching
    tradeSummary: (window: StatsWindow, signal?: AbortSignal) =>
      client.get<TradeSummary>('tradeMatching', '/stats/summary', {
        query: { ...window },
        signal,
      }),
    tradeTrend: (window: StatsWindow, bucket: TimeBucket, signal?: AbortSignal) =>
      client.get<Trend<TradeTrendBucket>>('tradeMatching', '/stats/trends', {
        query: trend(bucket, window),
        signal,
      }),
    tradeHouseholds: (query: HouseholdQuery, signal?: AbortSignal) =>
      client.get<Page<HouseholdTrading>>('tradeMatching', '/stats/households', {
        query: { ...query },
        signal,
      }),

    // billing
    billingSummary: (window: StatsWindow, signal?: AbortSignal) =>
      client.get<BillingSummary>('billing', '/stats/summary', { query: { ...window }, signal }),
    billingTrend: (window: StatsWindow, bucket: TimeBucket, signal?: AbortSignal) =>
      client.get<Trend<BillingTrendBucket>>('billing', '/stats/trends', {
        query: trend(bucket, window),
        signal,
      }),
    billingHouseholds: (query: HouseholdQuery, signal?: AbortSignal) =>
      client.get<Page<HouseholdBilling>>('billing', '/stats/households', {
        query: { ...query },
        signal,
      }),

    /**
     * Readiness is public and answers 503 with a report when a service is up
     * but cannot do its job, so a 503 here is information, not a failure.
     */
    readiness: async (service: ServiceName, signal?: AbortSignal): Promise<ReadinessResult> => {
      try {
        const response = await client.get<ReadinessReport>(service, '/health/ready', {
          authenticated: false,
          acceptStatuses: [503],
          signal,
        });
        return {
          report: response.data,
          httpStatus: response.status,
          latencyMs: response.durationMs,
          error: null,
        };
      } catch (error) {
        if (error instanceof ApiError) {
          return { report: null, httpStatus: error.details.status ?? null, latencyMs: null, error };
        }
        throw error;
      }
    },

    /**
     * Whether a token is an operator token, asked of one service. The cheapest
     * operator-only read there is: a summary over the last minute.
     */
    verifyOperatorToken: (
      service: ServiceName,
      token: string,
      now: Date,
      signal?: AbortSignal,
    ): Promise<ApiResponse<unknown>> =>
      client.get<unknown>(service, '/stats/summary', {
        token,
        query: { from: new Date(now.getTime() - 60_000).toISOString(), to: now.toISOString() },
        signal,
      }),
  };
}

export type SolarGridApi = ReturnType<typeof createSolarGridApi>;
