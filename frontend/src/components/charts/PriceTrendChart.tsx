import { memo, useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceTrendBucket, PricingBand, Trend } from '../../types/api';
import {
  formatBucketPeriod,
  formatBucketTick,
  formatCount,
  groupDigits,
  toChartNumber,
} from '../../utils/format';
import { hasActivity, priceRows, type PriceRow } from '../../utils/series';
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
 * The calculated price per bucket: the average as a line, the lowest to
 * highest as a bar behind it, and the pricing rule's floor and ceiling as rules,
 * so a price can be read against the limits it is clamped to. A bucket where
 * nothing was priced is a gap, not a zero.
 */
export const PriceTrendChart = memo(function PriceTrendChart({
  trend,
  band,
  syncId,
  height = 280,
}: {
  trend: Trend<PriceTrendBucket>;
  band: PricingBand | null;
  syncId?: string;
  height?: number;
}) {
  const rows = useMemo(() => priceRows(trend), [trend]);
  const currency = band?.currency ?? 'TRY';

  if (!hasActivity(rows, (bucket) => bucket.snapshots > 0)) {
    return (
      <EmptyState title="No price was calculated in this period.">
        The price is recalculated from neighbourhood supply and demand.
      </EmptyState>
    );
  }

  const floor = toChartNumber(band?.minPrice);
  const cap = toChartNumber(band?.maxPrice);
  const pricedPoints = rows.filter((row) => row.average !== null).length;

  return (
    <ChartFrame
      label="Price over time"
      legend={[
        { label: 'Average', color: SERIES.price, shape: 'line' },
        { label: 'Lowest to highest', color: SERIES.price, shape: 'band' },
        ...(band
          ? [{ label: 'Floor and ceiling', color: 'var(--color-ink-3)', shape: 'line' as const }]
          : []),
      ]}
      columns={[
        { header: 'Period' },
        { header: 'Calculations', align: 'right' },
        { header: `Average (${currency}/kWh)`, align: 'right' },
        { header: 'Lowest', align: 'right' },
        { header: 'Highest', align: 'right' },
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        formatCount(row.source.snapshots),
        groupDigits(row.source.averagePricePerKwh),
        groupDigits(row.source.minPricePerKwh),
        groupDigits(row.source.maxPricePerKwh),
      ])}
    >
      <div style={{ height: height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart data={rows} margin={CHART_MARGIN} syncId={syncId} title="Price over time">
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
              width={56}
              tickFormatter={formatAxisNumber}
              domain={['auto', 'auto']}
              label={unitLabel(`${currency}/kWh`)}
            />
            {floor !== null ? (
              <ReferenceLine
                y={floor}
                stroke={CHROME.tick}
                strokeOpacity={0.5}
                ifOverflow="extendDomain"
                label={{
                  value: `Floor ${band?.minPrice}`,
                  position: 'insideBottomRight',
                  fill: CHROME.tick,
                  fontSize: 12,
                }}
              />
            ) : null}
            {cap !== null ? (
              <ReferenceLine
                y={cap}
                stroke={CHROME.tick}
                strokeOpacity={0.5}
                ifOverflow="extendDomain"
                label={{
                  value: `Ceiling ${band?.maxPrice}`,
                  position: 'insideTopRight',
                  fill: CHROME.tick,
                  fontSize: 12,
                }}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: CHROME.crosshair, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as PriceRow | undefined;
                const unit = `${currency}/kWh`;
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={trend.bucket}
                    lines={
                      row
                        ? [
                            {
                              label: 'Average',
                              color: SERIES.price,
                              value: groupDigits(row.source.averagePricePerKwh),
                              unit: row.average === null ? undefined : unit,
                            },
                            { label: 'Lowest', value: groupDigits(row.source.minPricePerKwh) },
                            { label: 'Highest', value: groupDigits(row.source.maxPricePerKwh) },
                            { label: 'Calculations', value: formatCount(row.source.snapshots) },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            {/* Lowest to highest as a floating bar per bucket: unlike a band, it
                shows even when a single bucket was priced. */}
            <Bar
              dataKey="range"
              name="Lowest to highest"
              fill={SERIES.price}
              fillOpacity={0.3}
              maxBarSize={10}
              radius={2}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="average"
              name="Average"
              stroke={SERIES.price}
              connectNulls={false}
              dot={sparseDots(pricedPoints, SERIES.price)}
              activeDot={activeDot(SERIES.price)}
              {...LINE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
});
