import type { TimeBucket } from '../../types/api';
import { formatBucketPeriod } from '../../utils/format';

export interface TooltipLine {
  label: string;
  /** The series colour, for its key; omitted for a figure that is not drawn. */
  color?: string;
  /** Already formatted, from the API's own decimal string. */
  value: string;
  unit?: string;
}

/**
 * The hover readout: the period first, then every series at that point with
 * its value leading. Values are the API's strings, not the numbers the chart
 * was drawn from.
 */
export function ChartTooltip({
  active,
  bucketStart,
  bucket,
  lines,
}: {
  active?: boolean;
  bucketStart?: string;
  bucket: TimeBucket;
  lines: TooltipLine[];
}) {
  if (!active || !bucketStart) return null;
  return (
    <div className="min-w-44 rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-lg shadow-black/40">
      <p className="mb-1.5 text-ink-3">{formatBucketPeriod(bucketStart, bucket)}</p>
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: line.color ?? 'transparent' }}
              />
              {line.label}
            </span>
            <span className="figures font-semibold text-ink">
              {line.value}
              {line.unit ? <span className="ml-1 font-normal text-ink-3">{line.unit}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
