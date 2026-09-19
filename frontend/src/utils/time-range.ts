import type { TimeBucket } from '../types/api';
import type { StatsWindow } from '../services/solar-grid-api';

export type RangePreset = '24h' | '7d' | '30d' | 'custom';

export interface TimeWindow {
  preset: RangePreset;
  /** Inclusive, UTC. */
  from: Date;
  /** Exclusive, UTC. */
  to: Date;
  bucket: TimeBucket;
}

export const PRESETS: ReadonlyArray<{
  id: Exclude<RangePreset, 'custom'>;
  label: string;
  long: string;
}> = [
  { id: '24h', label: '24 h', long: 'Last 24 hours' },
  { id: '7d', label: '7 d', long: 'Last 7 days' },
  { id: '30d', label: '30 d', long: 'Last 30 days' },
];

/** The statistics API refuses a window with a `from` wider than this. */
export const MAX_WINDOW_DAYS = 366;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PRESET_SPANS: Record<Exclude<RangePreset, 'custom'>, { ms: number; bucket: TimeBucket }> = {
  '24h': { ms: DAY_MS, bucket: 'hour' },
  '7d': { ms: 7 * DAY_MS, bucket: 'hour' },
  '30d': { ms: 30 * DAY_MS, bucket: 'day' },
};

export function presetWindow(preset: Exclude<RangePreset, 'custom'>, now: Date): TimeWindow {
  const span = PRESET_SPANS[preset];
  return { preset, from: new Date(now.getTime() - span.ms), to: now, bucket: span.bucket };
}

/**
 * The bucket for a custom window: fine enough to show shape, coarse enough to
 * stay far below the API's bucket ceilings (744 hours, 366 days, 105 weeks).
 */
export function bucketFor(from: Date, to: Date): TimeBucket {
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days <= 2) return 'hour';
  if (days <= 92) return 'day';
  return 'week';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type CustomWindowResult =
  { window: TimeWindow; problem?: never } | { window?: never; problem: string };

/**
 * A window from two calendar dates in UTC, both days included.
 *
 * Checked here with the same rules the API applies, so the dashboard never
 * sends a request it knows will be refused, and the operator is told why in
 * their own terms rather than the API's.
 */
export function customWindow(fromDate: string, toDate: string, now: Date): CustomWindowResult {
  if (!DATE_ONLY.test(fromDate) || !DATE_ONLY.test(toDate)) {
    return { problem: 'Choose a start and an end date.' };
  }
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const lastDay = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(lastDay.getTime())) {
    return { problem: 'Choose a start and an end date.' };
  }
  if (from.getTime() > lastDay.getTime()) {
    return { problem: 'The start date must be on or before the end date.' };
  }
  if (from.getTime() > now.getTime()) {
    return { problem: 'The window starts in the future; there is nothing to show yet.' };
  }
  // The end date is included, so the window runs to the following midnight.
  const to = new Date(lastDay.getTime() + DAY_MS);
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_WINDOW_DAYS) {
    return { problem: `A window can cover at most ${MAX_WINDOW_DAYS} days.` };
  }
  return { window: { preset: 'custom', from, to, bucket: bucketFor(from, to) } };
}

export function toStatsWindow(window: TimeWindow): StatsWindow {
  return { from: window.from.toISOString(), to: window.to.toISOString() };
}

/** Identifies a window, so a change of window starts a new set of requests. */
export function windowKey(window: TimeWindow): string {
  return `${window.preset}|${window.from.toISOString()}|${window.to.toISOString()}|${window.bucket}`;
}

/** A date input's value (YYYY-MM-DD) for a UTC instant. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const BUCKET_LABELS: Record<TimeBucket, string> = {
  hour: 'hourly',
  day: 'daily',
  week: 'weekly',
};
