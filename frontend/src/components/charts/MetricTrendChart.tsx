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
import type { TimeBucket } from '../../types/api';
import { formatBucketPeriod, formatBucketTick } from '../../utils/format';
import type { ValueRow } from '../../utils/series';
import { EmptyState } from '../ui/primitives';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip, type TooltipLine } from './ChartTooltip';
import {
  activeDot,
  AXIS_TICK,
  CHART_MARGIN,
  CHROME,
  formatAxisNumber,
  LINE,
  sparseDots,
  unitLabel,
} from './chart-theme';

/**
 * One measure over time, on its own axis and in its own unit: bars for
 * amounts that add up per bucket, a line for a level such as a price. Charts
 * that share a `syncId` move their crosshairs together, so one moment can be
 * read across several measures without putting two units on one axis.
 */
export function MetricTrendChart<B>({
  title,
  unit,
  color,
  kind,
  rows,
  bucket,
  format,
  extraLines,
  syncId,
  height = 220,
  emptyTitle,
  isActive,
}: {
  title: string;
  unit: string;
  color: string;
  kind: 'bar' | 'line';
  rows: ValueRow<B>[];
  bucket: TimeBucket;
  /** The exact value for a bucket, as the API gave it. */
  format: (row: ValueRow<B>) => string;
  /** More readouts for the tooltip and the table. */
  extraLines?: (row: ValueRow<B>) => Array<{ label: string; value: string }>;
  syncId?: string;
  height?: number;
  emptyTitle: string;
  /** Whether anything happened in a bucket; with nothing anywhere, the chart says so instead. */
  isActive: (row: ValueRow<B>) => boolean;
}) {
  if (!rows.some(isActive)) return <EmptyState title={emptyTitle} />;

  const withValues = rows.filter((row) => row.value !== null).length;
  const extraHeaders = rows[0] && extraLines ? extraLines(rows[0]).map((line) => line.label) : [];

  return (
    <ChartFrame
      label={title}
      columns={[
        { header: 'Period' },
        { header: `${title} (${unit})`, align: 'right' },
        ...extraHeaders.map((header) => ({ header, align: 'right' as const })),
      ]}
      rows={rows.map((row) => [
        formatBucketPeriod(row.t, row.bucket),
        format(row),
        ...(extraLines ? extraLines(row).map((line) => line.value) : []),
      ])}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
          <ComposedChart data={rows} margin={CHART_MARGIN} syncId={syncId} title={title}>
            <CartesianGrid stroke={CHROME.grid} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(value: string) => formatBucketTick(value, bucket)}
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
              label={unitLabel(unit)}
            />
            <Tooltip
              cursor={
                kind === 'line'
                  ? { stroke: CHROME.crosshair, strokeWidth: 1 }
                  : { fill: 'rgba(255,255,255,0.04)' }
              }
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as ValueRow<B> | undefined;
                const lines: TooltipLine[] = row
                  ? [
                      {
                        label: title,
                        color,
                        value: format(row),
                        unit: row.value === null ? undefined : unit,
                      },
                      ...(extraLines ? extraLines(row) : []),
                    ]
                  : [];
                return (
                  <ChartTooltip
                    active={active}
                    bucketStart={row?.t}
                    bucket={bucket}
                    lines={lines}
                  />
                );
              }}
            />
            {kind === 'bar' ? (
              <Bar
                dataKey="value"
                name={title}
                fill={color}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ) : (
              <Line
                type="linear"
                dataKey="value"
                name={title}
                stroke={color}
                connectNulls={false}
                dot={sparseDots(withValues, color)}
                activeDot={activeDot(color)}
                {...LINE}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
