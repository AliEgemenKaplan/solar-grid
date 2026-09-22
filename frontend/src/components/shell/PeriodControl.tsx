import { useId, useState, type FormEvent } from 'react';
import { formatDateTime } from '../../utils/format';
import {
  BUCKET_LABELS,
  customWindow,
  MAX_WINDOW_DAYS,
  PRESETS,
  toDateInput,
  type RangePreset,
  type TimeWindow,
} from '../../utils/time-range';
import { Button, cx } from '../ui/primitives';

/**
 * The one filter every period figure follows: last 24 hours, 7 days, 30 days
 * or chosen dates. The period actually in use is spelled out in UTC beside
 * it, so there is never a doubt what the numbers cover.
 */
export function PeriodControl({
  timeWindow,
  onPreset,
  onCustom,
  now,
}: {
  timeWindow: TimeWindow;
  onPreset: (preset: Exclude<RangePreset, 'custom'>) => void;
  onCustom: (timeWindow: TimeWindow) => void;
  now: () => Date;
}) {
  const [editing, setEditing] = useState(timeWindow.preset === 'custom');
  const [from, setFrom] = useState(toDateInput(timeWindow.from));
  const [to, setTo] = useState(toDateInput(new Date(timeWindow.to.getTime() - 1)));
  const [problem, setProblem] = useState<string | null>(null);
  const groupName = useId();
  const fromId = useId();
  const toId = useId();
  const problemId = useId();

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const result = customWindow(from, to, now());
    if (result.problem !== undefined) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    onCustom(result.window);
  };

  const today = toDateInput(now());

  return (
    <section aria-label="Period" className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Show figures for</legend>
          <span aria-hidden="true" className="text-[13px] font-medium text-ink-2">
            Period
          </span>
          <div className="flex rounded-md border border-line bg-canvas p-0.5">
            {PRESETS.map((preset) => (
              <SegmentOption
                key={preset.id}
                name={groupName}
                label={preset.label}
                description={preset.long}
                checked={!editing && timeWindow.preset === preset.id}
                onSelect={() => {
                  setEditing(false);
                  setProblem(null);
                  onPreset(preset.id);
                }}
              />
            ))}
            <SegmentOption
              name={groupName}
              label="Custom"
              description="Custom dates"
              checked={editing}
              onSelect={() => setEditing(true)}
            />
          </div>
        </fieldset>

        {editing ? (
          <form onSubmit={apply} className="flex flex-wrap items-end gap-2" noValidate>
            <div className="flex flex-col">
              <label htmlFor={fromId} className="text-xs text-ink-3">
                From (UTC)
              </label>
              <input
                id={fromId}
                type="date"
                value={from}
                max={today}
                onChange={(event) => setFrom(event.target.value)}
                aria-invalid={problem !== null}
                aria-describedby={problem ? problemId : undefined}
                className="h-8 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink [color-scheme:dark]"
              />
            </div>
            <div className="flex flex-col">
              <label htmlFor={toId} className="text-xs text-ink-3">
                To, inclusive (UTC)
              </label>
              <input
                id={toId}
                type="date"
                value={to}
                max={today}
                onChange={(event) => setTo(event.target.value)}
                aria-invalid={problem !== null}
                aria-describedby={problem ? problemId : undefined}
                className="h-8 rounded-md border border-line bg-canvas px-2 text-[13px] text-ink [color-scheme:dark]"
              />
            </div>
            <Button type="submit" variant="primary">
              Apply
            </Button>
          </form>
        ) : null}

        <p className="text-[13px] text-ink-3 lg:ml-auto">
          Selected period:{' '}
          <span className="text-ink-2">
            {formatDateTime(timeWindow.from)} until {formatDateTime(timeWindow.to)}
          </span>{' '}
          · {BUCKET_LABELS[timeWindow.bucket]} buckets · all times are UTC
        </p>
      </div>
      {problem ? (
        <p id={problemId} role="alert" className="mt-2 text-[13px] text-serious">
          {problem}
        </p>
      ) : editing ? (
        <p className="mt-2 text-xs text-ink-3">
          Up to {MAX_WINDOW_DAYS} days. Both dates are included.
        </p>
      ) : null}
    </section>
  );
}

function SegmentOption({
  name,
  label,
  description,
  checked,
  onSelect,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cx(
        'relative cursor-pointer rounded px-3 py-1 text-[13px] font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
        checked ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink-2',
      )}
      title={description}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
        aria-label={description}
      />
      {label}
    </label>
  );
}
