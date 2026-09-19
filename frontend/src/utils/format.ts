import type { Decimal, TimeBucket } from '../types/api';

/**
 * Presentation of values that arrive as decimal strings.
 *
 * Nothing here turns money or energy into a JavaScript number: digits are
 * grouped by working on the string, so "12345678.905" is shown as
 * "12,345,678.905" and never as whatever a double makes of it.
 */

const DECIMAL = /^(-?)(\d+)(\.\d+)?$/;
export const MISSING = '—';

/** "12345.678" → "12,345.678". Anything that is not a plain decimal is shown as a dash. */
export function groupDigits(value: Decimal | null | undefined): string {
  if (value === null || value === undefined) return MISSING;
  const match = DECIMAL.exec(value.trim());
  if (!match) return MISSING;
  const [, sign, whole, fraction = ''] = match;
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction}`;
}

/** True for "0", "0.000", "-0.00". */
export function isZero(value: Decimal | null | undefined): boolean {
  return value !== null && value !== undefined && /^-?0+(\.0+)?$/.test(value.trim());
}

export function isNegative(value: Decimal | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim().startsWith('-') && !isZero(value);
}

/**
 * The value as a number, for placing a mark on a chart and nothing else.
 * A chart axis is pixels; the tooltip and the table still show the string.
 */
export function toChartNumber(value: Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const COUNT = new Intl.NumberFormat('en-US');
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? MISSING : COUNT.format(value);
}

/**
 * Dates are written by hand rather than through Intl: locale data differs
 * between browsers and versions ("Sep" in one, "Sept" in another), and an
 * operations screen should read the same on every machine.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (value: number) => String(value).padStart(2, '0');

function dayMonth(date: Date): string {
  return `${two(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}`;
}

function hourMinute(date: Date): string {
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

function asDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** "19 Sep 2026, 13:05 UTC". Always UTC, so every operator reads the same time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return MISSING;
  const date = asDate(value);
  return `${formatDate(date)}, ${hourMinute(date)} UTC`;
}

/** "19 Sep 2026". */
export function formatDate(value: string | Date): string {
  const date = asDate(value);
  return `${dayMonth(date)} ${date.getUTCFullYear()}`;
}

/** "13:05:42 UTC", for "last updated". */
export function formatTime(value: string | Date): string {
  const date = asDate(value);
  return `${hourMinute(date)}:${two(date.getUTCSeconds())} UTC`;
}

/** An axis label for the start of a bucket. */
export function formatBucketTick(value: string, bucket: TimeBucket): string {
  const date = asDate(value);
  if (bucket === 'hour') {
    const time = hourMinute(date);
    return time === '00:00' ? dayMonth(date) : time;
  }
  return dayMonth(date);
}

/** A tooltip heading for a bucket: what period the values cover. */
export function formatBucketPeriod(value: string, bucket: TimeBucket): string {
  const date = asDate(value);
  if (bucket === 'hour') return `${dayMonth(date)} ${hourMinute(date)} UTC, 1 hour`;
  if (bucket === 'day') return `${formatDate(date)}, 1 day`;
  return `Week of ${formatDate(date)}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return MISSING;
  return `${ms} ms`;
}
