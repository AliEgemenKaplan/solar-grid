import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { useAuth } from '../auth/auth-context';
import { AppShell } from '../components/shell/AppShell';
import { PeriodControl } from '../components/shell/PeriodControl';
import { PageHeader } from '../components/ui/layout';
import { LoadingBlock } from '../components/ui/primitives';
import { useAutoRefresh } from '../hooks/use-auto-refresh';
import { useDashboardData } from '../hooks/use-dashboard-data';
import { useDiagnostics } from '../hooks/use-diagnostics';
import { useHashRoute } from '../hooks/use-hash-route';
import { useServiceHealth } from '../hooks/use-service-health';
import { useServices } from '../services/services-context';
import { findIssues } from '../utils/attention';
import { periodLabel, presetWindow, type TimeWindow } from '../utils/time-range';
import { DashboardProvider, type DashboardContextValue } from './dashboard-context';
import { PAGES, type PageId } from './routes';

/** Each page is its own chunk, loaded the first time it is opened. */
const PAGE_MODULES: Record<PageId, () => Promise<{ default: ComponentType }>> = {
  overview: () =>
    import('../pages/OverviewPage').then((module) => ({ default: module.OverviewPage })),
  energy: () => import('../pages/EnergyPage').then((module) => ({ default: module.EnergyPage })),
  market: () => import('../pages/MarketPage').then((module) => ({ default: module.MarketPage })),
  trading: () => import('../pages/TradingPage').then((module) => ({ default: module.TradingPage })),
  billing: () => import('../pages/BillingPage').then((module) => ({ default: module.BillingPage })),
  households: () =>
    import('../pages/HouseholdsPage').then((module) => ({ default: module.HouseholdsPage })),
  system: () => import('../pages/SystemPage').then((module) => ({ default: module.SystemPage })),
};

const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  overview: lazy(PAGE_MODULES.overview),
  energy: lazy(PAGE_MODULES.energy),
  market: lazy(PAGE_MODULES.market),
  trading: lazy(PAGE_MODULES.trading),
  billing: lazy(PAGE_MODULES.billing),
  households: lazy(PAGE_MODULES.households),
  system: lazy(PAGE_MODULES.system),
};

/** Loads every page up front; for tests, which should not wait on a chunk per page. */
export function preloadPages(): Promise<unknown> {
  return Promise.all(Object.values(PAGE_MODULES).map((load) => load()));
}

const systemClock = () => new Date();

const APP_TITLE = 'SolarGrid Operator Control Center';

/**
 * The signed-in application. It loads what every page reads - the four
 * services' statistics for the period, their readiness and their counters -
 * once per refresh, and shares it, so moving between pages never waits and
 * every page shows the same moment.
 */
export function ControlCenter({ now = systemClock }: { now?: () => Date }) {
  const { config } = useServices();
  const { signOut } = useAuth();
  const [page, navigate] = useHashRoute();
  const [timeWindow, setWindow] = useState<TimeWindow>(() => presetWindow('24h', now()));
  const [refreshToken, setRefreshToken] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const data = useDashboardData(timeWindow, refreshToken);
  const health = useServiceHealth(refreshToken);
  const diagnostics = useDiagnostics(refreshToken);

  // A preset period slides forward to now on every refresh; custom dates
  // stay exactly where the operator put them.
  const refresh = useCallback(() => {
    setWindow((current) =>
      current.preset === 'custom' ? current : presetWindow(current.preset, now()),
    );
    setRefreshToken((token) => token + 1);
  }, [now]);

  const busy = data.busy || health.inFlight || diagnostics.inFlight;
  useAutoRefresh(autoRefresh, config.autoRefreshMs, busy, refresh);

  const issues = useMemo(
    () =>
      findIssues({
        health: health.data,
        sectionErrors: {
          smartMeter: data.energy.error,
          pricing: data.prices.error,
          tradeMatching: data.market.error,
          billing: data.billing.error,
        },
        market: data.market.data?.summary ?? null,
        billing: data.billing.data?.summary ?? null,
        diagnostics: diagnostics.data,
      }),
    [
      health.data,
      data.energy.error,
      data.prices.error,
      data.market.error,
      data.market.data,
      data.billing.error,
      data.billing.data,
      diagnostics.data,
    ],
  );

  const lastUpdated = latest(data.lastUpdated, health.updatedAt, diagnostics.updatedAt);
  const period = periodLabel(timeWindow);
  const periodControl = (
    <PeriodControl
      timeWindow={timeWindow}
      now={now}
      onPreset={(preset) => setWindow(presetWindow(preset, now()))}
      onCustom={setWindow}
    />
  );
  const context: DashboardContextValue = {
    timeWindow,
    period,
    periodControl,
    data,
    health,
    diagnostics,
    issues,
    refreshToken,
    navigate,
  };

  const definition = PAGES.find((entry) => entry.id === page) ?? PAGES[0]!;
  const Page = PAGE_COMPONENTS[page];

  // A new page starts at its top, wherever the last one was scrolled to.
  useEffect(() => {
    document.documentElement.scrollTop = 0;
  }, [page]);

  // The tab and the browser history name the page, not just the product.
  useEffect(() => {
    document.title = `${definition.label} · ${APP_TITLE}`;
    return () => {
      document.title = APP_TITLE;
    };
  }, [definition.label]);

  return (
    <DashboardProvider value={context}>
      <AppShell
        page={page}
        controls={{
          health,
          issues,
          lastUpdated,
          busy,
          autoRefresh,
          autoRefreshSeconds: Math.round(config.autoRefreshMs / 1000),
          onRefresh: refresh,
          onToggleAutoRefresh: () => setAutoRefresh((value) => !value),
          onSignOut: () => signOut('signed-out'),
        }}
      >
        <PageHeader title={definition.label} question={definition.question} />
        {/* The overview puts it under the system status, which no period changes;
            the system page's figures are not for a period at all. */}
        {page === 'overview' || page === 'system' ? null : periodControl}
        <Suspense fallback={<LoadingBlock label={`Loading ${definition.label}`} lines={6} />}>
          <Page />
        </Suspense>
      </AppShell>
    </DashboardProvider>
  );
}

function latest(...dates: Array<Date | null>): Date | null {
  const times = dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}
