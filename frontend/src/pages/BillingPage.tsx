import { useDashboard } from '../app/dashboard-context';
import { BooksStatus } from '../components/billing/BooksStatus';
import { SERIES } from '../components/charts/chart-theme';
import { MetricTrendChart } from '../components/charts/MetricTrendChart';
import { BigStat, Card, Figure, Section } from '../components/ui/layout';
import { Loaded } from '../components/ui/Loaded';
import { formatCount, groupDigits } from '../utils/format';
import { valueRows } from '../utils/series';

/** What billing settled in the period, whether the ledger balances, and where balances stand now. */
export function BillingPage() {
  const { period, data, timeWindow } = useDashboard();
  const bucket = timeWindow.bucket;

  return (
    <>
      <Loaded resource={data.billing} what="billing statistics" height={72}>
        {({ summary }) => <BooksStatus summary={summary} />}
      </Loaded>

      <Section
        title="Settled in the period"
        description={`${period}. Billing records a trade and its two ledger entries at the same moment, so settled and billed are the same thing here.`}
      >
        <Card>
          <Loaded resource={data.billing} what="billing statistics" height={160}>
            {({ summary }) => {
              const unit = summary.currency;
              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                    <BigStat
                      label="Money settled"
                      accent={SERIES.volume}
                      help="What buyers paid sellers, over every trade billing recorded in the period."
                      value={groupDigits(summary.trades.volume)}
                      unit={unit}
                    />
                    <BigStat
                      label="Energy settled"
                      accent={SERIES.traded}
                      help="The energy those trades moved from seller to buyer."
                      value={groupDigits(summary.trades.energyKwh)}
                      unit="kWh"
                    />
                    <BigStat
                      label="Trades settled"
                      help="Trades billing recorded. Trades it refused are not here; the Trading page counts them."
                      value={formatCount(summary.trades.trades)}
                      caption={`Between ${formatCount(summary.trades.households)} households.`}
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-5 border-t border-line pt-5 md:grid-cols-4">
                    <Figure
                      label="Credits"
                      help="Money added to sellers' balances."
                      value={groupDigits(summary.ledger.credited)}
                      unit={unit}
                    />
                    <Figure
                      label="Debits"
                      help="Money taken from buyers' balances."
                      value={groupDigits(summary.ledger.debited)}
                      unit={unit}
                    />
                    <Figure
                      label="Net"
                      help="Difference between total credits and debits. Zero when the books balance."
                      value={groupDigits(summary.ledger.net)}
                      unit={unit}
                    />
                    <Figure
                      label="Ledger entries"
                      help="One credit and one debit per settled trade."
                      value={formatCount(summary.ledger.entries)}
                      note={`${formatCount(summary.ledger.households)} households`}
                    />
                    <Figure
                      label="Paid on average"
                      help="Money settled divided by energy settled - so bigger trades count for more."
                      value={groupDigits(summary.trades.volumeWeightedPricePerKwh)}
                      unit={summary.trades.volumeWeightedPricePerKwh ? `${unit}/kWh` : undefined}
                    />
                    <Figure
                      label="Average trade price"
                      value={groupDigits(summary.trades.averagePricePerKwh)}
                      unit={summary.trades.averagePricePerKwh ? `${unit}/kWh` : undefined}
                    />
                    <Figure
                      label="Lowest trade price"
                      value={groupDigits(summary.trades.minPricePerKwh)}
                      unit={summary.trades.minPricePerKwh ? `${unit}/kWh` : undefined}
                    />
                    <Figure
                      label="Highest trade price"
                      value={groupDigits(summary.trades.maxPricePerKwh)}
                      unit={summary.trades.maxPricePerKwh ? `${unit}/kWh` : undefined}
                    />
                  </dl>
                </div>
              );
            }}
          </Loaded>
        </Card>
      </Section>

      <p className="-mt-2 text-[13px] text-ink-3">
        Billing and trade matching each count trades from their own records, so their totals can
        differ: a trade still waiting for billing is only in trade matching’s figures, and a trade
        recorded directly with billing - as the demo’s repeat-request check does - is only in
        billing’s.
      </p>

      <Section
        title="Balances right now"
        description="Where every household's balance stands today, from all trades ever settled - not only the selected period."
      >
        <Card>
          <Loaded resource={data.billing} what="balances" height={100}>
            {({ summary }) => {
              const { balances, currency } = summary;
              return (
                <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
                  <Figure
                    label="Households with a balance"
                    help="Every household that has ever settled a trade."
                    value={formatCount(balances.households)}
                  />
                  <Figure
                    label="In credit"
                    help="Households that have earned more selling energy than they have spent buying it."
                    value={formatCount(balances.inCredit)}
                    note={`${groupDigits(balances.totalCredit)} ${currency} in total`}
                  />
                  <Figure
                    label="In debit"
                    help="Households that have spent more buying energy than they have earned selling it."
                    value={formatCount(balances.inDebit)}
                    note={`${groupDigits(balances.totalDebit)} ${currency} in total`}
                  />
                  <Figure
                    label="Even"
                    help="Households whose earnings and spending are exactly equal."
                    value={formatCount(balances.settled)}
                  />
                </dl>
              );
            }}
          </Loaded>
        </Card>
      </Section>

      <Section title="Settled over time" description={`Per ${bucket}, as billing recorded it.`}>
        <Loaded resource={data.billing} what="billing over time" height={220}>
          {({ trend, summary }) => (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-[14px] font-semibold text-ink">Money settled</h3>
                <MetricTrendChart
                  title="Money settled"
                  unit={summary.currency}
                  color={SERIES.volume}
                  kind="bar"
                  rows={valueRows(trend, (row) => row.volume)}
                  bucket={trend.bucket}
                  format={(row) => groupDigits(row.source.volume)}
                  extraLines={(row) => [{ label: 'Trades', value: formatCount(row.source.trades) }]}
                  syncId="billing"
                  emptyTitle="No trades were settled in this period."
                  isActive={(row) => row.source.trades > 0}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-[14px] font-semibold text-ink">Energy settled</h3>
                <MetricTrendChart
                  title="Energy settled"
                  unit="kWh"
                  color={SERIES.traded}
                  kind="bar"
                  rows={valueRows(trend, (row) => row.energyKwh)}
                  bucket={trend.bucket}
                  format={(row) => groupDigits(row.source.energyKwh)}
                  syncId="billing"
                  emptyTitle="No trades were settled in this period."
                  isActive={(row) => row.source.trades > 0}
                />
              </Card>
            </div>
          )}
        </Loaded>
      </Section>
    </>
  );
}
