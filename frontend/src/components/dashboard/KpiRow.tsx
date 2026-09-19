import type { ReactNode } from 'react';
import type { EnergySection, MarketSection, PriceSection } from '../../hooks/use-dashboard-data';
import type { Resource } from '../../hooks/use-resource';
import { formatCount, groupDigits, isNegative, isZero } from '../../utils/format';
import { SERIES } from '../charts/chart-theme';
import { cx, Skeleton } from '../ui/primitives';

/**
 * The six figures an operator reads first. Each comes straight from a summary
 * the API computed; nothing here is added up in the browser.
 */
export function KpiRow({
  energy,
  market,
  prices,
}: {
  energy: Resource<EnergySection>;
  market: Resource<MarketSection>;
  prices: Resource<PriceSection>;
}) {
  const e = energy.data?.summary;
  const m = market.data?.summary;
  const currency = m?.currency ?? 'TRY';

  return (
    <section
      aria-label="Key figures"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <Kpi
        label="Production"
        color={SERIES.production}
        resource={energy}
        value={groupDigits(e?.productionKwh)}
        unit="kWh"
        hint={e ? `${groupDigits(e.surplusKwh)} kWh offered as surplus` : null}
      />
      <Kpi
        label="Consumption"
        color={SERIES.consumption}
        resource={energy}
        value={groupDigits(e?.consumptionKwh)}
        unit="kWh"
        hint={e ? `${groupDigits(e.demandKwh)} kWh requested as demand` : null}
      />
      <Kpi
        label="Net energy"
        color={SERIES.net}
        resource={energy}
        value={groupDigits(e?.netKwh)}
        unit="kWh"
        hint={e ? `${netDirection(e.netKwh)} · ${formatCount(e.readings)} readings` : null}
      />
      <Kpi
        label="Traded energy"
        color={SERIES.traded}
        resource={market}
        value={groupDigits(m?.completed.energyKwh)}
        unit="kWh"
        hint={m ? `${formatCount(m.trades.completed)} settled trades` : null}
      />
      <Kpi
        label="Trade volume"
        color={SERIES.volume}
        resource={market}
        value={groupDigits(m?.completed.volume)}
        unit={currency}
        hint={m ? `${formatCount(m.households)} households trading` : null}
      />
      <Kpi
        label="Average price"
        color={SERIES.price}
        resource={market}
        value={groupDigits(m?.completed.volumeWeightedPricePerKwh)}
        unit={m?.completed.volumeWeightedPricePerKwh ? `${currency}/kWh` : undefined}
        hint={
          m?.completed.volumeWeightedPricePerKwh
            ? `Volume weighted · now ${groupDigits(prices.data?.current.pricePerKwh)}`
            : prices.data
              ? `No settled trades · now ${groupDigits(prices.data.current.pricePerKwh)} ${prices.data.current.currency}/kWh`
              : 'No settled trades in this window'
        }
      />
    </section>
  );
}

function netDirection(net: string): string {
  if (isZero(net)) return 'Balanced';
  return isNegative(net) ? 'Net import' : 'Net export';
}

function Kpi<T>({
  label,
  color,
  resource,
  value,
  unit,
  hint,
}: {
  label: string;
  color: string;
  resource: Resource<T>;
  value: string;
  unit?: string;
  hint: ReactNode;
}) {
  return (
    <div
      className="min-w-0 rounded-lg border border-line bg-surface px-4 py-3"
      aria-busy={resource.refreshing || resource.status === 'loading' || undefined}
    >
      <p className="flex items-center gap-2 text-xs text-ink-3">
        <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: color }} />
        {label}
      </p>
      {resource.status === 'loading' ? (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-32" />
          <span className="sr-only">Loading {label.toLowerCase()}</span>
        </div>
      ) : resource.status === 'error' ? (
        <p className="mt-2 text-sm text-ink-2">
          Unavailable
          <span className="mt-0.5 block text-xs text-ink-3">{resource.error?.message}</span>
        </p>
      ) : (
        <div className={cx('transition-opacity', resource.refreshing && 'opacity-60')}>
          <p
            className="mt-1.5 truncate text-[22px] font-semibold leading-tight text-ink"
            title={value}
          >
            {value}
            {unit ? <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span> : null}
          </p>
          <p
            className="mt-1 truncate text-xs text-ink-3"
            title={typeof hint === 'string' ? hint : undefined}
          >
            {hint}
          </p>
        </div>
      )}
    </div>
  );
}
