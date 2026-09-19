import { useCallback, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { EnergyTrendChart } from '../components/charts/EnergyTrendChart';
import { MarketTrendChart } from '../components/charts/MarketTrendChart';
import { PriceTrendChart } from '../components/charts/PriceTrendChart';
import { BillingPanel } from '../components/dashboard/BillingPanel';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { HouseholdActivity } from '../components/dashboard/HouseholdActivity';
import { KpiRow } from '../components/dashboard/KpiRow';
import { MarketActivity } from '../components/dashboard/MarketActivity';
import { RangeControl } from '../components/dashboard/RangeControl';
import { ServiceHealthPanel } from '../components/dashboard/ServiceHealthPanel';
import { ErrorState, Fact, Panel, Skeleton } from '../components/ui/primitives';
import { useAutoRefresh } from '../hooks/use-auto-refresh';
import { useDashboardData, type PriceSection } from '../hooks/use-dashboard-data';
import type { Resource } from '../hooks/use-resource';
import { useServiceHealth } from '../hooks/use-service-health';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { useServices } from '../services/services-context';
import { formatCount, formatDateTime, groupDigits } from '../utils/format';
import { presetWindow, type TimeWindow } from '../utils/time-range';

const systemClock = () => new Date();

export function DashboardPage({ now = systemClock }: { now?: () => Date }) {
  const { config } = useServices();
  const { signOut } = useAuth();
  const [timeWindow, setWindow] = useState<TimeWindow>(() => presetWindow('24h', now()));
  const [refreshToken, setRefreshToken] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const data = useDashboardData(timeWindow, refreshToken);
  const health = useServiceHealth(refreshToken);

  // A preset window slides forward to now on every refresh; a custom window
  // stays exactly where the operator put it.
  const refresh = useCallback(() => {
    setWindow((current) =>
      current.preset === 'custom' ? current : presetWindow(current.preset, now()),
    );
    setRefreshToken((token) => token + 1);
  }, [now]);

  useAutoRefresh(autoRefresh, config.autoRefreshMs, data.busy || health.inFlight, refresh);

  return (
    <DashboardLayout
      header={
        <DashboardHeader
          health={health}
          lastUpdated={data.lastUpdated}
          busy={data.busy}
          autoRefresh={autoRefresh}
          autoRefreshSeconds={Math.round(config.autoRefreshMs / 1000)}
          onRefresh={refresh}
          onToggleAutoRefresh={() => setAutoRefresh((value) => !value)}
          onSignOut={() => signOut('signed-out')}
        />
      }
    >
      <h1 className="sr-only">Solar Grid operator dashboard</h1>

      <RangeControl
        timeWindow={timeWindow}
        now={now}
        onPreset={(preset) => setWindow(presetWindow(preset, now()))}
        onCustom={setWindow}
      />

      <KpiRow energy={data.energy} market={data.market} prices={data.prices} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Energy"
          subtitle="Production, consumption and net across all meters, kWh"
          refreshing={data.energy.refreshing}
        >
          <ChartState resource={data.energy} what="energy statistics">
            {(section) => <EnergyTrendChart trend={section.trend} />}
          </ChartState>
        </Panel>
        <Panel
          title="Market"
          subtitle="Settled trades: energy, volume and average price"
          refreshing={data.market.refreshing}
        >
          <ChartState resource={data.market} what="market statistics">
            {(section) => (
              <MarketTrendChart trend={section.trend} currency={section.summary.currency} />
            )}
          </ChartState>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel
          title="Price"
          subtitle="Calculated from neighbourhood supply and demand"
          refreshing={data.prices.refreshing}
          className="xl:col-span-2"
        >
          <ChartState resource={data.prices} what="price statistics">
            {(section) => <PriceBody section={section} />}
          </ChartState>
        </Panel>
        <div className="min-w-0 xl:col-span-3">
          <MarketActivity market={data.market} />
        </div>
      </div>

      <HouseholdActivity timeWindow={timeWindow} refreshToken={refreshToken} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BillingPanel billing={data.billing} />
        <ServiceHealthPanel health={health} />
      </div>
    </DashboardLayout>
  );
}

/** Loading, failed or ready, the same way for every chart panel. */
function ChartState<T>({
  resource,
  what,
  children,
}: {
  resource: Resource<T>;
  what: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading') {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading {what}</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }
  if (resource.status === 'error' || resource.data === null) {
    return (
      <ErrorState
        title={`Unable to load ${what}.`}
        error={resource.error}
        retrying={resource.refreshing}
      />
    );
  }
  return <>{children(resource.data)}</>;
}

function PriceBody({ section }: { section: PriceSection }) {
  const { summary, current, trend } = section;
  const unit = `${current.currency}/kWh`;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-4">
        <Fact
          label="Current price"
          value={groupDigits(current.pricePerKwh)}
          unit={unit}
          hint={formatDateTime(current.calculatedAt)}
        />
        <Fact
          label="Average in window"
          value={groupDigits(summary.averagePricePerKwh)}
          unit={summary.averagePricePerKwh ? unit : undefined}
          hint={`${formatCount(summary.snapshots)} calculations`}
        />
        <Fact
          label="Band"
          value={
            summary.band
              ? `${groupDigits(summary.band.minPrice)}–${groupDigits(summary.band.maxPrice)}`
              : '—'
          }
          unit={summary.band ? unit : undefined}
          hint={summary.band ? `Base ${groupDigits(summary.band.basePrice)}` : 'No active rule'}
        />
      </dl>
      <PriceTrendChart trend={trend} band={summary.band} />
    </div>
  );
}
