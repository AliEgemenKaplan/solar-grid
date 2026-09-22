import { memo, useMemo } from 'react';
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
import type { PriceTrendBucket, TradeTrendBucket, Trend } from '../../types/api';
import { formatBucketPeriod, formatBucketTick, formatCount, groupDigits } from '../../utils/format';
import {
  hasActivity,
  marketRows,
  priceInputRows,
  type MarketRow,
  type PriceInputRow,
} from '../../utils/series';
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
  unitLabel,
} from './chart-theme';

/**
 * The supply and demand the pricing engine was given each time it set the
 * price: when demand runs above supply the price rises, when supply runs
 * above demand it falls, within the band. Buckets with no calculation are
 * gaps.
 */
export const PriceInputsChart = memo(function PriceInputsChart({
  trend,
  syncId,
  height = 240,
}: {
  trend: Trend<PriceTrendBucket>;
  syncId?: string;
  height?: number;
}) {
  const rows = useMemo(() => priceInputRows(trend), [trend]);
  if (!hasActivity(rows, (bucket) => bucket.snapshots > 0)) {
    return <EmptyState title="No price was calculated in this period." />;
  }
  const points = rows.filter((row) => row.supply !== null).length;

  return (
    <ChartFrame
      label="Supply and demand behind the price"
      legend={[
        { label: 'Supply', color: SERIES.production, shape: 'line' },
        { label: 'Demand', color: SERIES.consumption, shape: 'line' },
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Calculations', align: 'right' },
        { header: 'Average supply (kWh)', align: 'right' },
        { header: 'Average demand (kWh)', align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.snapshots),
        row.supply === null ? '—' : groupDigits(row.source.averageSupplyKwh),
        row.demand === null ? '—' : groupDigits(row.source.averageDemandKwh),
      ])}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart
            data={rows}
            margin={CHART_MARGIN}
            syncId={syncId}
            title="Supply and demand behind the price"
          >
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(value: string) => formatBucketTick(value, trend.bucket)}
              tick={AXIS_TICK}
              stroke={CHROME.axis}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tick={AXIS_TICK}
              stroke={CHROME.axis}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={formatAxisNumber}
              label={unitLabel('kWh')}
            />
            <Tooltip
              cursor={{ stroke: CHROME.crosshair, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as PriceInputRow | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={trend.bucket}
                    lines={
                      row && row.supply !== null
                        ? [
                            {
                              label: 'Supply',
                              color: SERIES.production,
                              value: groupDigits(row.source.averageSupplyKwh),
                              unit: 'kWh',
                            },
                            {
                              label: 'Demand',
                              color: SERIES.consumption,
                              value: groupDigits(row.source.averageDemandKwh),
                              unit: 'kWh',
                            },
                            { label: 'Calculations', value: formatCount(row.source.snapshots) },
                          ]
                        : [{ label: 'No price calculated', value: '—' }]
                    }
                  />
                );
              }}
            />
            <Line
              type="linear"
              dataKey="supply"
              name="Supply"
              stroke={SERIES.production}
              connectNulls={false}
              dot={sparseDots(points, SERIES.production)}
              activeDot={activeDot(SERIES.production)}
              {...LINE}
            />
            <Line
              type="linear"
              dataKey="demand"
              name="Demand"
              stroke={SERIES.consumption}
              connectNulls={false}
              dot={sparseDots(points, SERIES.consumption)}
              activeDot={activeDot(SERIES.consumption)}
              {...LINE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});

/**
 * How many trades were made in each bucket, beside how many of those have
 * settled. Both are counts, so they share one axis.
 */
export const TradesOverTimeChart = memo(function TradesOverTimeChart({
  trend,
  syncId,
  height = 240,
}: {
  trend: Trend<TradeTrendBucket>;
  syncId?: string;
  height?: number;
}) {
  const rows = useMemo(() => marketRows(trend), [trend]);
  if (!hasActivity(rows, (bucket) => bucket.trades > 0)) {
    return <EmptyState title="No trades were made in this period." />;
  }

  return (
    <ChartFrame
      label="Trades over time"
      legend={[
        { label: 'Trades made', color: SERIES.traded, shape: 'bar' },
        { label: 'Of those, settled', color: SERIES.net, shape: 'bar' },
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Trades made', align: 'right' },
        { header: 'Settled', align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.trades),
        formatCount(row.source.completed),
      ])}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart
            data={rows}
            margin={CHART_MARGIN}
            syncId={syncId}
            title="Trades over time"
            barGap={2}
          >
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(value: string) => formatBucketTick(value, trend.bucket)}
              tick={AXIS_TICK}
              stroke={CHROME.axis}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tick={AXIS_TICK}
              stroke={CHROME.axis}
              tickLine={false}
              axisLine={false}
              width={60}
              allowDecimals={false}
              label={unitLabel('trades')}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as MarketRow | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={trend.bucket}
                    lines={
                      row
                        ? [
                            {
                              label: 'Trades made',
                              color: SERIES.traded,
                              value: formatCount(row.source.trades),
                            },
                            {
                              label: 'Settled',
                              color: SERIES.net,
                              value: formatCount(row.source.completed),
                            },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Bar
              dataKey={(row: MarketRow) => row.source.trades}
              name="Trades made"
              fill={SERIES.traded}
              maxBarSize={18}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey={(row: MarketRow) => row.source.completed}
              name="Settled"
              fill={SERIES.net}
              maxBarSize={18}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});
