import { SETTLEMENT_CURRENCY } from '../../config/defaults';
import { useResource, type Resource } from '../../hooks/use-resource';
import { useServices } from '../../services/services-context';
import type { HouseholdEnergy, HouseholdTrading, Page } from '../../types/api';
import { groupDigits, toChartNumber } from '../../utils/format';
import { toStatsWindow, windowKey, type TimeWindow } from '../../utils/time-range';
import { SERIES } from '../charts/chart-theme';
import { Card } from '../ui/layout';
import { EmptyState, ErrorState, LoadingBlock } from '../ui/primitives';

const TOP = 8;

/**
 * The households at the top of two orders the services themselves sort by:
 * money moved in settled trades, and energy produced. Only those orders -
 * the dashboard does not re-rank a page of results into a list the service
 * never computed.
 */
interface RankingProps {
  timeWindow: TimeWindow;
  refreshToken: number;
  onSelect: (householdId: string) => void;
}

export function HouseholdRankings(props: RankingProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <TradingRanking {...props} />
      <ProducerRanking {...props} />
    </div>
  );
}

/** Most money moved in settled trades, as trade matching orders it. */
export function TradingRanking({ timeWindow, refreshToken, onSelect }: RankingProps) {
  const { api } = useServices();
  const query = { ...toStatsWindow(timeWindow), page: 1, limit: TOP };
  const trading = useResource(
    `ranking-trading|${windowKey(timeWindow)}`,
    refreshToken,
    async (signal) => (await api.tradeHouseholds(query, signal)).data,
  );
  return (
    <Card>
      <h3 className="text-[15px] font-semibold text-ink">Highest trading volume</h3>
      <p className="mt-0.5 mb-4 text-[13px] text-ink-3">
        Money received for energy sold plus money paid for energy bought, in settled trades.
      </p>
      <Ranking
        resource={trading}
        empty="No household completed a trade in this period."
        onSelect={onSelect}
        bars={(row: HouseholdTrading) => [
          {
            value: row.sellVolume,
            color: SERIES.volume,
            label: `${groupDigits(row.sellVolume)} received`,
          },
          {
            value: row.buyVolume,
            color: SERIES.volume,
            faded: true,
            label: `${groupDigits(row.buyVolume)} paid`,
          },
        ]}
        caption={`${SETTLEMENT_CURRENCY}; darker is received, lighter is paid`}
      />
    </Card>
  );
}

/** Most energy produced, as the smart meter service orders it. */
export function ProducerRanking({ timeWindow, refreshToken, onSelect }: RankingProps) {
  const { api } = useServices();
  const query = { ...toStatsWindow(timeWindow), page: 1, limit: TOP };
  const energy = useResource(
    `ranking-energy|${windowKey(timeWindow)}`,
    refreshToken,
    async (signal) => (await api.energyHouseholds(query, signal)).data,
  );
  return (
    <Card>
      <h3 className="text-[15px] font-semibold text-ink">Largest producers</h3>
      <p className="mt-0.5 mb-4 text-[13px] text-ink-3">
        Energy each household’s panels generated.
      </p>
      <Ranking
        resource={energy}
        empty="No household reported a reading in this period."
        onSelect={onSelect}
        bars={(row: HouseholdEnergy) => [
          {
            value: row.productionKwh,
            color: SERIES.production,
            label: `${groupDigits(row.productionKwh)} kWh produced`,
          },
        ]}
        caption="kWh"
      />
    </Card>
  );
}

interface RankedBar {
  value: string;
  color: string;
  faded?: boolean;
  label: string;
}

function Ranking<T extends { householdId: string }>({
  resource,
  empty,
  bars,
  caption,
  onSelect,
}: {
  resource: Resource<Page<T>>;
  empty: string;
  bars: (row: T) => RankedBar[];
  caption: string;
  onSelect: (householdId: string) => void;
}) {
  if (resource.status === 'loading') return <LoadingBlock label="Loading the ranking" lines={4} />;
  if (resource.status === 'error' || !resource.data) {
    return (
      <ErrorState
        title="Unable to load the ranking."
        error={resource.error}
        retrying={resource.refreshing}
      />
    );
  }
  const rows = resource.data.items;
  if (rows.length === 0) return <EmptyState title={empty} />;

  // Bar lengths only: each row's bars share one scale, set by the longest row.
  const lengths = rows.map((row) =>
    bars(row).reduce((sum, bar) => sum + (toChartNumber(bar.value) ?? 0), 0),
  );
  const longest = Math.max(...lengths, 0);

  return (
    <div>
      <ol className="space-y-2">
        {rows.map((row, index) => {
          const parts = bars(row);
          return (
            <li key={row.householdId}>
              <button
                type="button"
                onClick={() => onSelect(row.householdId)}
                className="group block w-full rounded-md px-2 py-1.5 text-left hover:bg-raised/60"
                aria-label={`${index + 1}. ${row.householdId}: ${parts.map((bar) => bar.label).join(', ')}. Show details.`}
              >
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span
                    className="min-w-0 truncate font-mono text-xs text-ink-3"
                    title={row.householdId}
                  >
                    {index + 1}. {row.householdId}
                  </span>
                  <span className="shrink-0 text-ink">
                    {parts.map((bar) => bar.label).join(' · ')}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="mt-1 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-sm bg-raised"
                >
                  {parts.map((bar, barIndex) => {
                    const value = toChartNumber(bar.value) ?? 0;
                    const width = longest > 0 ? (value / longest) * 100 : 0;
                    return width > 0 ? (
                      <span
                        key={barIndex}
                        style={{
                          width: `${width}%`,
                          background: bar.color,
                          opacity: bar.faded ? 0.4 : 1,
                        }}
                      />
                    ) : null;
                  })}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-ink-3">
        Top {rows.length} of {resource.data.total} · {caption} · select a household for details
      </p>
    </div>
  );
}
