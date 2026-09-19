import { memo, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EnergyTrendBucket, Trend } from '../../types/api';
import { formatBucketPeriod, formatBucketTick, formatCount, groupDigits } from '../../utils/format';
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
} from './chart-theme';

const HEIGHT = 260;

/**
 * Production, consumption and their difference over the window. Production
 * and consumption carry a light wash so the gap between them reads as the
 * surplus or deficit; net is a line around a zero rule, since it goes
 * negative whenever the neighbourhood uses more than it makes.
 */
export const EnergyTrendChart = memo(function EnergyTrendChart({
  trend,
}: {
  trend: Trend<EnergyTrendBucket>;
}) {
  const rows = useMemo(() => energyRows(trend), [trend]);

  if (!hasActivity(rows, (bucket) => bucket.readings > 0)) {
    return (
      <EmptyState title="No meter readings in this window.">
        Readings appear here as meters report. Try a longer window.
      </EmptyState>
    );
  }

  return (
    <ChartFrame
      label="Energy over time"
      legend={[
        { label: 'Production', color: SERIES.production, shape: 'area' },
        { label: 'Consumption', color: SERIES.consumption, shape: 'area' },
        { label: 'Net', color: SERIES.net, shape: 'line' },
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Readings', align: 'right' },
        { header: 'Production (kWh)', align: 'right' },
        { header: 'Consumption (kWh)', align: 'right' },
        { header: 'Net (kWh)', align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.readings),
        groupDigits(row.source.productionKwh),
        groupDigits(row.source.consumptionKwh),
        groupDigits(row.source.netKwh),
      ])}
    >
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer
          width="100%"
          height={HEIGHT}
          initialDimension={{ width: 640, height: HEIGHT }}
        >
          <ComposedChart data={rows} margin={CHART_MARGIN} title="Energy over time">
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            <XAxis
              dataKey="t"
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
              width={56}
              tickFormatter={formatAxisNumber}
              label={{
                value: 'kWh',
                position: 'insideTopLeft',
                dy: -8,
                dx: 8,
                fill: CHROME.tick,
                fontSize: 11,
              }}
            />
            <ReferenceLine y={0} stroke={CHROME.axis} />
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
                              label: 'Production',
                              color: SERIES.production,
                              value: groupDigits(row.source.productionKwh),
                              unit: 'kWh',
                            },
                            {
                              label: 'Consumption',
                              color: SERIES.consumption,
                              value: groupDigits(row.source.consumptionKwh),
                              unit: 'kWh',
                            },
                            {
                              label: 'Net',
                              color: SERIES.net,
                              value: groupDigits(row.source.netKwh),
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
              name="Production"
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
              name="Consumption"
              stroke={SERIES.consumption}
              fill={SERIES.consumption}
              fillOpacity={0.1}
              activeDot={activeDot(SERIES.consumption)}
              dot={false}
              {...LINE}
            />
            <Line
              type="linear"
              dataKey="net"
              name="Net"
              stroke={SERIES.net}
              activeDot={activeDot(SERIES.net)}
              dot={false}
              {...LINE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});
