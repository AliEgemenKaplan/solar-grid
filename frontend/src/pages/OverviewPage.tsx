import type { ReactNode } from 'react';
import { useDashboard } from '../app/dashboard-context';
import type { PageId } from '../app/routes';
import { BooksStatus } from '../components/billing/BooksStatus';
import { EnergyTrendChart } from '../components/charts/EnergyTrendChart';
import { PriceBand } from '../components/market/PriceBand';
import { EnergyFlow } from '../components/overview/EnergyFlow';
import { GridOverview } from '../components/overview/GridOverview';
import { AttentionPanel, SystemStatusBanner } from '../components/status/SystemStatus';
import { TradeOutcomes } from '../components/trading/TradingVisuals';
import { ArrowRightIcon } from '../components/ui/icons';
import { BigStat, Card, Section } from '../components/ui/layout';
import { Loaded } from '../components/ui/Loaded';
import { formatCount, formatDateTime, groupDigits } from '../utils/format';

/**
 * The page anyone can read in a few seconds: is it working, is anything
 * wrong, what did the grid do in the period, and where to look next.
 */
export function OverviewPage() {
  const { health, issues, period, periodControl, data, timeWindow, navigate } = useDashboard();
  return (
    <>
      <SystemStatusBanner health={health} onOpen={() => navigate('system')} />
      <AttentionPanel issues={issues} checking={!health.data} onOpen={navigate} />
      {periodControl}
      <GridOverview period={period} energy={data.energy} market={data.market} />
      <EnergyFlow period={period} energy={data.energy} market={data.market} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Snapshot title="Market" page="market" linkLabel="Open the market" onOpen={navigate}>
          <Loaded resource={data.prices} what="the price" height={120}>
            {({ current, summary }) => (
              <div className="space-y-5">
                <BigStat
                  size="medium"
                  label="Price right now"
                  help="The price the next trade would be made at. It is recalculated from how much energy is offered and how much is wanted."
                  value={groupDigits(current.pricePerKwh)}
                  unit={`${current.currency}/kWh`}
                  caption={`Calculated ${formatDateTime(current.calculatedAt)}.`}
                />
                <PriceBand
                  band={summary.band}
                  current={current.pricePerKwh}
                  unit={`${current.currency}/kWh`}
                  observedLow={summary.minPricePerKwh}
                  observedHigh={summary.maxPricePerKwh}
                  markers={[]}
                />
              </div>
            )}
          </Loaded>
        </Snapshot>

        <Snapshot title="Trading" page="trading" linkLabel="Open trading" onOpen={navigate}>
          <Loaded resource={data.market} what="the trades" height={120}>
            {({ summary }) => (
              <div className="space-y-5">
                <BigStat
                  size="medium"
                  label="Trades made"
                  help="Every time spare energy from one household was matched with another household's demand."
                  value={formatCount(summary.trades.total)}
                  caption={`${period}, between ${formatCount(summary.households)} households.`}
                />
                <TradeOutcomes summary={summary} compact />
              </div>
            )}
          </Loaded>
        </Snapshot>

        <Snapshot title="Billing" page="billing" linkLabel="Open billing" onOpen={navigate}>
          <Loaded resource={data.billing} what="billing" height={120}>
            {({ summary }) => (
              <div className="space-y-5">
                <BigStat
                  size="medium"
                  label="Money settled"
                  help="What buyers paid sellers for energy, in trades billing has recorded."
                  value={groupDigits(summary.trades.volume)}
                  unit={summary.currency}
                  caption={`${period}, in ${formatCount(summary.trades.trades)} ${summary.trades.trades === 1 ? 'trade' : 'trades'} recorded by billing.`}
                />
                <BooksStatus summary={summary} size="compact" />
              </div>
            )}
          </Loaded>
        </Snapshot>
      </div>

      <Section
        title="Production and use over time"
        description={`${period}. Produced and used energy per ${timeWindow.bucket}, in kWh.`}
        actions={<OpenLink label="Energy details" page="energy" onOpen={navigate} />}
      >
        <Card>
          <Loaded resource={data.energy} what="energy over time" height={280}>
            {({ trend }) => <EnergyTrendChart trend={trend} height={280} />}
          </Loaded>
        </Card>
      </Section>
    </>
  );
}

function Snapshot({
  title,
  page,
  linkLabel,
  onOpen,
  children,
}: {
  title: string;
  page: PageId;
  linkLabel: string;
  onOpen: (page: PageId) => void;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <OpenLink label={linkLabel} page={page} onOpen={onOpen} />
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

function OpenLink({
  label,
  page,
  onOpen,
}: {
  label: string;
  page: PageId;
  onOpen: (page: PageId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(page)}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-raised hover:text-ink"
    >
      {label}
      <ArrowRightIcon />
    </button>
  );
}
