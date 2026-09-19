import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/config';
import {
  formatBucketPeriod,
  formatDateTime,
  groupDigits,
  isNegative,
  isZero,
} from '../src/utils/format';
import { energyRows, marketRows, priceRows } from '../src/utils/series';
import { bucketFor, customWindow, presetWindow, toStatsWindow } from '../src/utils/time-range';
import { energyTrend, priceTrend, tradeTrend } from './fixtures';

const NOW = new Date('2026-09-19T12:34:56.000Z');

describe('decimal presentation', () => {
  it.each([
    ['12345678.905', '12,345,678.905'],
    ['-1234.50', '-1,234.50'],
    ['0.000', '0.000'],
    ['999', '999'],
    ['1000', '1,000'],
  ])('groups %s as %s without going through a number', (value, expected) => {
    expect(groupDigits(value)).toBe(expected);
  });

  it('keeps every digit a double would lose', () => {
    expect(groupDigits('90071992547409931.23')).toBe('90,071,992,547,409,931.23');
  });

  it.each([null, undefined, 'abc', '1e5', ''])('shows %s as a dash', (value) => {
    expect(groupDigits(value as string | null | undefined)).toBe('—');
  });

  it('tells zero and negative apart as strings', () => {
    expect(isZero('0.00')).toBe(true);
    expect(isZero('-0.00')).toBe(true);
    expect(isZero('0.01')).toBe(false);
    expect(isNegative('-4.000')).toBe(true);
    expect(isNegative('-0.000')).toBe(false);
  });

  it('writes every time in UTC and says so', () => {
    expect(formatDateTime('2026-09-19T23:30:00.000Z')).toBe('19 Sep 2026, 23:30 UTC');
    expect(formatBucketPeriod('2026-09-19T09:00:00.000Z', 'hour')).toBe('19 Sep 09:00 UTC, 1 hour');
    expect(formatBucketPeriod('2026-09-14T00:00:00.000Z', 'week')).toBe('Week of 14 Sep 2026');
  });
});

describe('time windows', () => {
  it.each([
    ['24h', 24, 'hour'],
    ['7d', 7 * 24, 'hour'],
    ['30d', 30 * 24, 'day'],
  ] as const)('%s covers %i hours in %s buckets, ending now', (preset, hours, bucket) => {
    const window = presetWindow(preset, NOW);
    expect(window.to).toEqual(NOW);
    expect((window.to.getTime() - window.from.getTime()) / 3_600_000).toBe(hours);
    expect(window.bucket).toBe(bucket);
  });

  it('maps a window to the API parameters as UTC instants', () => {
    expect(toStatsWindow(presetWindow('24h', NOW))).toEqual({
      from: '2026-09-18T12:34:56.000Z',
      to: '2026-09-19T12:34:56.000Z',
    });
  });

  it('includes the end date of a custom window', () => {
    const result = customWindow('2026-09-01', '2026-09-03', NOW);
    expect(result.window).toMatchObject({
      preset: 'custom',
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-04T00:00:00.000Z'),
      bucket: 'day',
    });
  });

  it.each([
    ['', '2026-09-03', 'Choose a start and an end date.'],
    ['2026-09-05', '2026-09-03', 'The start date must be on or before the end date.'],
    ['2026-10-01', '2026-10-02', 'The window starts in the future; there is nothing to show yet.'],
    ['2025-01-01', '2026-09-01', 'A window can cover at most 366 days.'],
  ])('refuses %s to %s before asking the API', (from, to, problem) => {
    expect(customWindow(from, to, NOW)).toEqual({ problem });
  });

  it('accepts the longest window the API allows', () => {
    expect(customWindow('2025-09-19', '2026-09-19', NOW).window?.bucket).toBe('week');
  });

  it('picks a bucket that stays inside the API limits', () => {
    const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
    expect(bucketFor(NOW, at(2))).toBe('hour');
    expect(bucketFor(NOW, at(92))).toBe('day');
    expect(bucketFor(NOW, at(366))).toBe('week');
  });
});

describe('chart series', () => {
  it('turns every energy bucket into one row, quiet buckets as zeros', () => {
    const rows = energyRows(energyTrend);
    expect(rows.map((row) => [row.t, row.production, row.consumption, row.net])).toEqual([
      ['2026-09-19T09:00:00.000Z', 13, 7, 6],
      ['2026-09-19T10:00:00.000Z', 0, 0, 0],
      ['2026-09-19T11:00:00.000Z', 1, 5, -4],
    ]);
    // The tooltip and table read the API's own strings.
    expect(rows[2]!.source.netKwh).toBe('-4.000');
  });

  it('leaves an average with nothing to average as a gap, not a zero', () => {
    const rows = marketRows(tradeTrend);
    expect(rows.map((row) => [row.energy, row.volume, row.averagePrice])).toEqual([
      [10, 40, 4],
      [0, 0, null],
      [5, 25, 5],
    ]);
  });

  it('draws the price band only where prices were calculated', () => {
    expect(priceRows(priceTrend).map((row) => [row.average, row.range])).toEqual([
      [3, [2, 4]],
      [null, null],
      [6, [6, 6]],
    ]);
  });
});

describe('configuration', () => {
  it('uses the local Docker ports when nothing is set', () => {
    expect(readConfig({}).apiUrls).toEqual({
      smartMeter: 'http://localhost:3001',
      pricing: 'http://localhost:3002',
      tradeMatching: 'http://localhost:3003',
      billing: 'http://localhost:3004',
    });
  });

  it('takes the addresses from VITE_ variables', () => {
    const config = readConfig({
      VITE_BILLING_API_URL: 'https://billing.example/',
      VITE_AUTO_REFRESH_MS: '15000',
    });
    expect(config.apiUrls.billing).toBe('https://billing.example');
    expect(config.autoRefreshMs).toBe(15_000);
  });

  it.each([
    [{ VITE_PRICING_API_URL: 'not a url' }, 'VITE_PRICING_API_URL is not a valid URL.'],
    [
      { VITE_PRICING_API_URL: 'ftp://pricing' },
      'VITE_PRICING_API_URL must be an http or https URL.',
    ],
    [
      { VITE_REQUEST_TIMEOUT_MS: '-5' },
      'VITE_REQUEST_TIMEOUT_MS must be a positive whole number of milliseconds.',
    ],
  ])('refuses %o', (env, message) => {
    expect(() => readConfig(env)).toThrow(message);
  });
});
