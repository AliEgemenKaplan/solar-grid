import { useDashboard } from '../app/dashboard-context';
import { SERIES } from '../components/charts/chart-theme';
import { MetricTrendChart } from '../components/charts/MetricTrendChart';
import { PriceTrendChart } from '../components/charts/PriceTrendChart';
import { PriceInputsChart } from '../components/charts/SupplyDemandCharts';
import { PriceBand } from '../components/market/PriceBand';
import { BigStat, Card, Figure, Section } from '../components/ui/layout';
import { Loaded } from '../components/ui/Loaded';
import { formatCount, formatDateTime, groupDigits, MISSING } from '../utils/format';
import { valueRows } from '../utils/series';

/** The charts on this page move their crosshairs together: one moment, read across all of them. */
const SYNC = 'market';

/** What energy costs now and over the period, what set that price, and what traded at it. */
export function MarketPage() {
  const { period, data, timeWindow } = useDashboard();
  const bucket = timeWindow.bucket;
  const tradeSummary = data.market.data?.summary ?? null;

  return (
    <>
      <Section
        title="Price now"
        description="The price the next trade would be made at, and where it sits in the allowed range."
      >
        <Card>
          <Loaded resource={data.prices} what="the price" height={140}>
            {({ current, summary }) => {
              const unit = `${current.currency}/kWh`;
              return (
                <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <BigStat
                    label="Current price"
                    accent={SERIES.price}
                    help="Recalculated from how much energy is offered and how much is wanted. More demand than supply raises it; more supply lowers it."
                    value={groupDigits(current.pricePerKwh)}
                    unit={unit}
                    caption={`Calculated ${formatDateTime(current.calculatedAt)}, from ${groupDigits(current.supplyKwh)} kWh offered and ${groupDigits(current.demandKwh)} kWh wanted.`}
                  />
                  <PriceBand
                    band={summary.band}
                    current={current.pricePerKwh}
                    unit={unit}
                    observedLow={summary.minPricePerKwh}
                    observedHigh={summary.maxPricePerKwh}
                    markers={[
                      { label: 'Period average', value: summary.averagePricePerKwh },
                      {
                        label: 'Paid on average',
                        value: tradeSummary?.completed.volumeWeightedPricePerKwh ?? null,
                      },
                    ]}
                  />
                </div>
              );
            }}
          </Loaded>
        </Card>
      </Section>

      <Section title="Prices in the period" description={period}>
        <Card>
          <Loaded resource={data.prices} what="price statistics" height={80}>
            {({ summary }) => {
              const unit = `${summary.band?.currency ?? tradeSummary?.currency ?? 'TRY'}/kWh`;
              return (
                <dl className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
                  <Figure
                    label="Average price"
                    help="The mean of every price calculated in the period."
                    value={groupDigits(summary.averagePricePerKwh)}
                    unit={summary.averagePricePerKwh ? unit : undefined}
                  />
                  <Figure
                    label="Lowest"
                    value={groupDigits(summary.minPricePerKwh)}
                    unit={summary.minPricePerKwh ? unit : undefined}
                  />
                  <Figure
                    label="Highest"
                    value={groupDigits(summary.maxPricePerKwh)}
                    unit={summary.maxPricePerKwh ? unit : undefined}
                  />
                  <Figure
                    label="Price calculations"
                    help="How many times the pricing engine recalculated the price in the period."
                    value={formatCount(summary.snapshots)}
                  />
                  <Figure
                    label="Paid on average"
                    help="Money paid divided by energy traded, over the settled trades - so bigger trades count for more."
                    value={
                      tradeSummary
                        ? groupDigits(tradeSummary.completed.volumeWeightedPricePerKwh)
                        : MISSING
                    }
                    unit={tradeSummary?.completed.volumeWeightedPricePerKwh ? unit : undefined}
                  />
                  <Figure
                    label="Average trade price"
                    help="The mean price of a settled trade, whatever its size."
                    value={
                      tradeSummary
                        ? groupDigits(tradeSummary.completed.averagePricePerKwh)
                        : MISSING
                    }
                    unit={tradeSummary?.completed.averagePricePerKwh ? unit : undefined}
                  />
                </dl>
              );
            }}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="Price over time"
        description={`The average price per ${bucket}, with the lowest-to-highest range as a bar and the allowed floor and ceiling as grey lines.`}
      >
        <Card>
          <Loaded resource={data.prices} what="prices over time" height={280}>
            {({ trend, summary }) => (
              <PriceTrendChart trend={trend} band={summary.band} syncId={SYNC} />
            )}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="What set the price"
        description={`Energy on offer (supply) and energy wanted (demand) that each price was calculated from, averaged per ${bucket}, in kWh.`}
      >
        <Card>
          <Loaded resource={data.prices} what="supply and demand" height={240}>
            {({ trend }) => <PriceInputsChart trend={trend} syncId={SYNC} />}
          </Loaded>
        </Card>
      </Section>

      <Section
        title="Traded in the market"
        description={`Settled trades per ${bucket}. Each measure on its own chart, in its own unit.`}
      >
        <Loaded resource={data.market} what="market statistics" height={220}>
          {({ trend, summary }) => (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card>
                <h3 className="mb-3 text-[14px] font-semibold text-ink">Energy traded</h3>
                <MetricTrendChart
                  title="Energy traded"
                  unit="kWh"
                  color={SERIES.traded}
                  kind="bar"
                  rows={valueRows(trend, (row) => row.energyKwh)}
                  bucket={trend.bucket}
                  format={(row) => groupDigits(row.source.energyKwh)}
                  syncId={SYNC}
                  emptyTitle="No trades were settled in this period."
                  isActive={(row) => row.source.completed > 0}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-[14px] font-semibold text-ink">Money traded</h3>
                <MetricTrendChart
                  title="Money traded"
                  unit={summary.currency}
                  color={SERIES.volume}
                  kind="bar"
                  rows={valueRows(trend, (row) => row.volume)}
                  bucket={trend.bucket}
                  format={(row) => groupDigits(row.source.volume)}
                  syncId={SYNC}
                  emptyTitle="No trades were settled in this period."
                  isActive={(row) => row.source.completed > 0}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-[14px] font-semibold text-ink">Average trade price</h3>
                <MetricTrendChart
                  title="Average trade price"
                  unit={`${summary.currency}/kWh`}
                  color={SERIES.price}
                  kind="line"
                  rows={valueRows(trend, (row) => row.averagePricePerKwh)}
                  bucket={trend.bucket}
                  format={(row) => groupDigits(row.source.averagePricePerKwh)}
                  syncId={SYNC}
                  emptyTitle="No trades were settled in this period."
                  isActive={(row) => row.source.completed > 0}
                />
              </Card>
            </div>
          )}
        </Loaded>
      </Section>
    </>
  );
}
