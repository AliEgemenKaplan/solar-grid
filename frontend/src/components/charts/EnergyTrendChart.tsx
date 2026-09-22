import { memo, useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EnergyTrendBucket, Trend } from '../../types/api';
import {
  formatBucketPeriod,
  formatBucketTick,
  formatCount,
  groupDigits,
  isNegative,
  isZero,
} from '../../utils/format';
import { energyRows, hasActivity, type EnergyRow } from '../../utils/series';
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
  unitLabel,
} from './chart-theme';

function xAxis(trend: Trend<EnergyTrendBucket>) {
  return (
    <XAxis
      dataKey="t"
      tickFormatter={(value: string) => formatBucketTick(value, trend.bucket)}
      tick={AXIS_TICK}
      stroke={CHROME.axis}
      tickLine={false}
      minTickGap={32}
    />
  );
}

function yAxis() {
  return (
    <YAxis
      tick={AXIS_TICK}
      stroke={CHROME.axis}
      tickLine={false}
      axisLine={false}
      width={60}
      tickFormatter={formatAxisNumber}
      label={unitLabel('kWh')}
    />
  );
}

/**
 * How much the meters recorded being generated and used, per bucket. Two
 * washes on one axis, because both are energy in kWh; where they part is
 * where the neighbourhood had spare energy or needed more.
 */
export const EnergyTrendChart = memo(function EnergyTrendChart({
  trend,
  height = 320,
}: {
  trend: Trend<EnergyTrendBucket>;
  height?: number;
}) {
  const rows = useMemo(() => energyRows(trend), [trend]);

  if (!hasActivity(rows, (bucket) => bucket.readings > 0)) {
    return (
      <EmptyState title="No meter readings in this period.">
        Readings appear here as household meters report. Try a longer period.
      </EmptyState>
    );
  }

  return (
    <ChartFrame
      label="Energy produced and used over time"
      legend={[
        { label: 'Produced', color: SERIES.production, shape: 'area' },
        { label: 'Used', color: SERIES.consumption, shape: 'area' },
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Readings', align: 'right' },
        { header: 'Produced (kWh)', align: 'right' },
        { header: 'Used (kWh)', align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.readings),
        groupDigits(row.source.productionKwh),
        groupDigits(row.source.consumptionKwh),
      ])}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart
            data={rows}
            margin={CHART_MARGIN}
            title="Energy produced and used over time"
          >
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            {xAxis(trend)}
            {yAxis()}
            <Tooltip
              cursor={{ stroke: CHROME.crosshair, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as EnergyRow | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={trend.bucket}
                    lines={
                      row
                        ? [
                            {
                              label: 'Produced',
                              color: SERIES.production,
                              value: groupDigits(row.source.productionKwh),
                              unit: 'kWh',
                            },
                            {
                              label: 'Used',
                              color: SERIES.consumption,
                              value: groupDigits(row.source.consumptionKwh),
                              unit: 'kWh',
                            },
                            { label: 'Readings', value: formatCount(row.source.readings) },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Area
              type="linear"
              dataKey="production"
              name="Produced"
              stroke={SERIES.production}
              fill={SERIES.production}
              fillOpacity={0.1}
              activeDot={activeDot(SERIES.production)}
              dot={false}
              {...LINE}
            />
            <Area
              type="linear"
              dataKey="consumption"
              name="Used"
              stroke={SERIES.consumption}
              fill={SERIES.consumption}
              fillOpacity={0.1}
              activeDot={activeDot(SERIES.consumption)}
              dot={false}
              {...LINE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});

/**
 * Produced minus used, per bucket, as bars from a zero line: above it the
 * neighbourhood made more than it used, below it used more than it made. The
 * position says which; the colour and the legend say it again.
 */
export const NetEnergyChart = memo(function NetEnergyChart({
  trend,
  height = 240,
}: {
  trend: Trend<EnergyTrendBucket>;
  height?: number;
}) {
  const rows = useMemo(() => energyRows(trend), [trend]);

  if (!hasActivity(rows, (bucket) => bucket.readings > 0)) {
    return <EmptyState title="No meter readings in this period." />;
  }
  // Bars of height zero would look like a chart with nothing on it.
  if (!hasActivity(rows, (bucket) => bucket.readings > 0 && !isZero(bucket.netKwh))) {
    return (
      <EmptyState title={`Net energy was 0 kWh in every ${trend.bucket} with readings.`}>
        Whenever meters reported, the households together used exactly as much energy as they
        produced.
      </EmptyState>
    );
  }

  return (
    <ChartFrame
      label="Net energy over time"
      legend={[
        { label: 'More produced than used', color: SERIES.net, shape: 'bar' },
        { label: 'More used than produced', color: SERIES.deficit, shape: 'bar' },
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Net (kWh)', align: 'right' },
        { header: 'Meaning' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        groupDigits(row.source.netKwh),
        row.source.readings === 0
          ? 'No readings'
          : isNegative(row.source.netKwh)
            ? 'More used than produced'
            : 'More produced than used',
      ])}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart data={rows} margin={CHART_MARGIN} title="Net energy over time">
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            {xAxis(trend)}
            {yAxis()}
            <ReferenceLine y={0} stroke={CHROME.tick} strokeOpacity={0.6} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as EnergyRow | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={trend.bucket}
                    lines={
                      row
                        ? [
                            {
                              label: isNegative(row.source.netKwh)
                                ? 'More used than produced'
                                : 'Net',
                              color: isNegative(row.source.netKwh) ? SERIES.deficit : SERIES.net,
                              value: groupDigits(row.source.netKwh),
                              unit: 'kWh',
                            },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Bar
              dataKey="net"
              name="Net"
              maxBarSize={24}
              radius={[3, 3, 3, 3]}
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={row.t} fill={row.net < 0 ? SERIES.deficit : SERIES.net} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});
