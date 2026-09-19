import { memo, useId, useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TradeTrendBucket, Trend } from '../../types/api';
import { formatBucketPeriod, formatBucketTick, formatCount, groupDigits } from '../../utils/format';
import { hasActivity, marketRows, type MarketRow } from '../../utils/series';
import { EmptyState } from '../ui/primitives';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import {
  activeDot,
  AXIS_TICK,
  CHART_MARGIN,
  CHROME,
  formatAxisNumber,
  LINE,
  SERIES,
  sparseDots,
} from './chart-theme';

const PANEL_HEIGHT = 84;
const AXIS_HEIGHT = 24;

type Metric = 'energy' | 'volume' | 'averagePrice';

const METRICS: ReadonlyArray<{ key: Metric; label: string; unit: string; color: string }> = [
  { key: 'energy', label: 'Traded energy', unit: 'kWh', color: SERIES.traded },
  { key: 'volume', label: 'Trade volume', unit: 'TRY', color: SERIES.volume },
  { key: 'averagePrice', label: 'Average price', unit: 'TRY/kWh', color: SERIES.price },
];

/**
 * Traded energy, trade volume and average price, as three small charts on one
 * time axis rather than one chart with two scales: kilowatt hours and lira
 * share no unit, and a second y-axis would invent a relationship between
 * them. The charts move together - hovering one shows the readout for all
 * three - and only settled trades are counted, as the API reports them.
 */
export const MarketTrendChart = memo(function MarketTrendChart({
  trend,
  currency,
}: {
  trend: Trend<TradeTrendBucket>;
  currency: string;
}) {
  const rows = useMemo(() => marketRows(trend), [trend]);
  const syncId = useId();

  if (!hasActivity(rows, (bucket) => bucket.trades > 0)) {
    return (
      <EmptyState title="No trading activity in this window.">
        Trades appear here once surplus and demand are matched.
      </EmptyState>
    );
  }

  const pricedPoints = rows.filter((row) => row.averagePrice !== null).length;

  return (
    <ChartFrame
      label="Market activity over time"
      columns={[
        { header: 'Period' },
        { header: 'Trades', align: 'right' },
        { header: 'Settled', align: 'right' },
        { header: 'Traded energy (kWh)', align: 'right' },
        { header: `Volume (${currency})`, align: 'right' },
        { header: `Average price (${currency}/kWh)`, align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.trades),
        formatCount(row.source.completed),
        groupDigits(row.source.energyKwh),
        groupDigits(row.source.volume),
        groupDigits(row.source.averagePricePerKwh),
      ])}
    >
      <div className="space-y-1">
        {METRICS.map((metric, index) => {
          const last = index === METRICS.length - 1;
          const height = PANEL_HEIGHT + (last ? AXIS_HEIGHT : 0);
          return (
            <div key={metric.key} className="grid grid-cols-[7.5rem_1fr] items-start gap-2">
              <div className="pt-2">
                <p className="text-xs font-medium text-ink-2">{metric.label}</p>
                <p className="text-[11px] text-ink-3">{metric.unit.replace('TRY', currency)}</p>
              </div>
              <div style={{ height }}>
                <ResponsiveContainer
                  width="100%"
                  height={height}
                  initialDimension={{ width: 560, height }}
                >
                  <ComposedChart
                    data={rows}
                    margin={{ ...CHART_MARGIN, top: 6 }}
                    syncId={syncId}
                    title={metric.label}
                  >
                    <CartesianGrid stroke={CHROME.grid} vertical={false} />
                    <XAxis
                      dataKey="t"
                      hide={!last}
                      height={AXIS_HEIGHT}
                      tickFormatter={(value: string) => formatBucketTick(value, trend.bucket)}
                      tick={AXIS_TICK}
                      stroke={CHROME.axis}
                      tickLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      stroke={CHROME.axis}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickCount={3}
                      tickFormatter={formatAxisNumber}
                    />
                    <Tooltip
                      cursor={
                        metric.key === 'averagePrice'
                          ? { stroke: CHROME.crosshair, strokeWidth: 1 }
                          : { fill: 'rgba(255,255,255,0.04)' }
                      }
                      // One readout for all three, on the bottom chart.
                      content={
                        last
                          ? ({ active, payload }) => {
                              const row = payload?.[0]?.payload as MarketRow | undefined;
                              return (
                                <ChartTooltip
                                  active={active}
                                  bucketStart={row?.t}
                                  bucket={trend.bucket}
                                  lines={row ? tooltipLines(row, currency) : []}
                                />
                              );
                            }
                          : () => null
                      }
                    />
                    {metric.key === 'averagePrice' ? (
                      <Line
                        type="linear"
                        dataKey="averagePrice"
                        name={metric.label}
                        stroke={metric.color}
                        connectNulls={false}
                        dot={sparseDots(pricedPoints, metric.color)}
                        activeDot={activeDot(metric.color)}
                        {...LINE}
                      />
                    ) : (
                      <Bar
                        dataKey={metric.key}
                        name={metric.label}
                        fill={metric.color}
                        maxBarSize={24}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
});

function tooltipLines(row: MarketRow, currency: string) {
  return [
    {
      label: 'Traded energy',
      color: SERIES.traded,
      value: groupDigits(row.source.energyKwh),
      unit: 'kWh',
    },
    {
      label: 'Volume',
      color: SERIES.volume,
      value: groupDigits(row.source.volume),
      unit: currency,
    },
    {
      label: 'Average price',
      color: SERIES.price,
      value: groupDigits(row.source.averagePricePerKwh),
      unit: row.source.averagePricePerKwh ? `${currency}/kWh` : undefined,
    },
    { label: 'Settled trades', value: formatCount(row.source.completed) },
  ];
}
