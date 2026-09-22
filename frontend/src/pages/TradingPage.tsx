import { useDashboard } from '../app/dashboard-context';
import { SERIES } from '../components/charts/chart-theme';
import { TradesOverTimeChart } from '../components/charts/SupplyDemandCharts';
import { TradingRanking } from '../components/households/HouseholdRankings';
import { useHouseholdDetail } from '../components/households/use-household-detail';
import { BookSide, TradeOutcomes } from '../components/trading/TradingVisuals';
import { BigStat, Card, Section } from '../components/ui/layout';
import { Loaded } from '../components/ui/Loaded';
import { formatCount, groupDigits } from '../utils/format';

/** Which offers and requests became trades, how those trades ended, and who traded. */
export function TradingPage() {
  const { period, data, timeWindow, refreshToken } = useDashboard();
  const detail = useHouseholdDetail();
  const bucket = timeWindow.bucket;

  return (
    <>
      <Section
        title="Trades in the period"
        description={`${period}, as the trade matching service recorded them.`}
      >
        <Card>
          <Loaded resource={data.market} what="trade statistics" height={120}>
            {({ summary }) => (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
                <BigStat
                  label="Trades made"
                  help="Every time spare energy from one household was matched with another household's demand, whatever happened next."
                  value={formatCount(summary.trades.total)}
                  caption={`Between ${formatCount(summary.households)} households.`}
                />
                <BigStat
                  label="Energy traded"
                  accent={SERIES.traded}
                  help="Energy sold from one household to another in trades billing has settled."
                  value={groupDigits(summary.completed.energyKwh)}
                  unit="kWh"
                  caption={`In ${formatCount(summary.trades.completed)} settled ${summary.trades.completed === 1 ? 'trade' : 'trades'}.`}
                />
                <BigStat
                  label="Money traded"
                  accent={SERIES.volume}
                  help="What buyers paid sellers in settled trades."
                  value={groupDigits(summary.completed.volume)}
                  unit={summary.currency}
                />
                <BigStat
                  label="Reserved, not settled"
                  help="Energy committed to trades but not yet settled. It is neither traded nor available until billing answers."
                  value={groupDigits(summary.pending.energyKwh)}
                  unit="kWh"
                  caption={`${groupDigits(summary.pending.volume)} ${summary.currency} in ${formatCount(summary.trades.pendingBilling)} ${summary.trades.pendingBilling === 1 ? 'trade' : 'trades'} waiting for billing.`}
                />
              </div>
            )}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="How the trades ended"
        description="Every trade is exactly one of these, so together they add up to all trades made."
      >
        <Card>
          <Loaded resource={data.market} what="trade outcomes" height={120}>
            {({ summary }) => <TradeOutcomes summary={summary} />}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="Supply and demand"
        description="Energy offered for sale and energy asked for, in offers and requests opened in the period, and how much of each found a match."
      >
        <Card>
          <Loaded resource={data.market} what="offers and requests" height={160}>
            {({ summary }) => (
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                <BookSide
                  title="Offered for sale"
                  help="Households with spare energy offer it to the market. Matched energy found a buyer; the rest is still waiting for one."
                  book={summary.offers}
                  color={SERIES.production}
                  totalLabel="Offered"
                  openLabel="Still unsold"
                />
                <BookSide
                  title="Asked for"
                  help="Households short of energy ask the market for it. Matched energy found a seller; the rest is still waiting for one."
                  book={summary.requests}
                  color={SERIES.consumption}
                  totalLabel="Requested"
                  openLabel="Still unmet"
                />
              </div>
            )}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="Trades over time"
        description={`Trades made and trades settled, per ${bucket}.`}
      >
        <Card>
          <Loaded resource={data.market} what="trades over time" height={240}>
            {({ trend }) => <TradesOverTimeChart trend={trend} />}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="Who traded the most"
        description="Households by money moved in settled trades, as the trade matching service ranks them."
      >
        <TradingRanking
          timeWindow={timeWindow}
          refreshToken={refreshToken}
          onSelect={detail.open}
        />
      </Section>
      {detail.drawer}
    </>
  );
}
