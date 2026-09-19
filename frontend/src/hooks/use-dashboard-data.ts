import { useServices } from '../services/services-context';
import type {
  BillingSummary,
  CurrentPrice,
  EnergySummary,
  EnergyTrendBucket,
  PriceSummary,
  PriceTrendBucket,
  TradeSummary,
  TradeTrendBucket,
  Trend,
} from '../types/api';
import { toStatsWindow, windowKey, type TimeWindow } from '../utils/time-range';
import { useResource, type Resource } from './use-resource';

export interface EnergySection {
  summary: EnergySummary;
  trend: Trend<EnergyTrendBucket>;
}

export interface MarketSection {
  summary: TradeSummary;
  trend: Trend<TradeTrendBucket>;
}

export interface PriceSection {
  summary: PriceSummary;
  trend: Trend<PriceTrendBucket>;
  current: CurrentPrice;
}

export interface BillingSection {
  summary: BillingSummary;
}

export interface DashboardData {
  energy: Resource<EnergySection>;
  market: Resource<MarketSection>;
  prices: Resource<PriceSection>;
  billing: Resource<BillingSection>;
  /** Some section is still waiting for an answer. */
  busy: boolean;
  /** When the most recent section answered. */
  lastUpdated: Date | null;
}

/**
 * Everything the dashboard shows for one window, loaded once and shared by
 * every panel rather than fetched again by each of them.
 *
 * Each service is its own section: they load in parallel, and a service that
 * is down fails only its own panels while the rest of the dashboard carries
 * on. That mirrors the backend, where each service answers for its own data.
 */
export function useDashboardData(timeWindow: TimeWindow, refreshToken: number): DashboardData {
  const { api } = useServices();
  const key = windowKey(timeWindow);
  const stats = toStatsWindow(timeWindow);

  const energy = useResource(key, refreshToken, async (signal) => {
    const [summary, trend] = await Promise.all([
      api.energySummary(stats, signal),
      api.energyTrend(stats, timeWindow.bucket, signal),
    ]);
    return { summary: summary.data, trend: trend.data };
  });

  const market = useResource(key, refreshToken, async (signal) => {
    const [summary, trend] = await Promise.all([
      api.tradeSummary(stats, signal),
      api.tradeTrend(stats, timeWindow.bucket, signal),
    ]);
    return { summary: summary.data, trend: trend.data };
  });

  const prices = useResource(key, refreshToken, async (signal) => {
    const [summary, trend, current] = await Promise.all([
      api.priceSummary(stats, signal),
      api.priceTrend(stats, timeWindow.bucket, signal),
      api.currentPrice(signal),
    ]);
    return { summary: summary.data, trend: trend.data, current: current.data };
  });

  const billing = useResource(key, refreshToken, async (signal) => {
    const summary = await api.billingSummary(stats, signal);
    return { summary: summary.data };
  });

  const sections = [energy, market, prices, billing];
  const updates = sections
    .map((section) => section.updatedAt?.getTime())
    .filter((time): time is number => time !== undefined);

  return {
    energy,
    market,
    prices,
    billing,
    busy: sections.some((section) => section.inFlight),
    lastUpdated: updates.length > 0 ? new Date(Math.max(...updates)) : null,
  };
}
