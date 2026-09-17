import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  addBuckets,
  bucketStarts,
  BUCKET_WINDOWS,
  describeRange,
  instantProblem,
  MAX_RANGE_DAYS,
  parseInstant,
  resolveStatsRange,
  resolveTrendWindow,
  StatsRangeQuery,
  StatsTrendQuery,
  truncateToBucket,
} from '../src/analytics/stats-range';
import { energyOrZero, isoOrNull, moneyOrZero, priceOrNull } from '../src/analytics/aggregates';

const NOW = new Date('2026-05-27T13:45:12.000Z');

async function problemsFor(type: typeof StatsRangeQuery, query: Record<string, unknown>) {
  const instance = plainToInstance(type, query);
  const errors = await validate(instance as object);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('instant bounds', () => {
  it.each([
    '2026-05-27',
    '2026-05-27T10:00Z',
    '2026-05-27T10:00:00Z',
    '2026-05-27T10:00:00.500Z',
    '2026-05-27T13:00:00+03:00',
  ])('accepts %s', (value) => {
    expect(instantProblem(value)).toBeNull();
  });

  it.each([
    ['2026-05-27T10:00:00', 'a time without an offset is ambiguous'],
    ['27/05/2026', 'not ISO-8601'],
    ['2026-13-01', 'not a real month'],
    ['yesterday', 'not a date at all'],
    ['', 'empty'],
    [42, 'not a string'],
  ])('refuses %s (%s)', (value: string | number, _why: string) => {
    expect(instantProblem(value)).not.toBeNull();
  });

  it('reads a date as midnight UTC, whatever the machine time zone', () => {
    expect(parseInstant('2026-05-27').toISOString()).toBe('2026-05-27T00:00:00.000Z');
  });

  it('honours an explicit offset', () => {
    expect(parseInstant('2026-05-27T13:00:00+03:00').toISOString()).toBe(
      '2026-05-27T10:00:00.000Z',
    );
  });

  it('rejects a malformed bound with a message naming the field', async () => {
    const problems = await problemsFor(StatsRangeQuery, { from: 'not-a-date' });
    expect(problems.join(' ')).toContain('from must be an ISO-8601');
  });

  it('accepts a query with no bounds at all', async () => {
    expect(await problemsFor(StatsRangeQuery, {})).toEqual([]);
  });
});

describe('resolveStatsRange', () => {
  it('reads the whole history when nothing is asked for', () => {
    expect(resolveStatsRange(plainToInstance(StatsRangeQuery, {}), NOW)).toEqual({
      from: null,
      to: null,
    });
  });

  it('returns the window it was given', () => {
    const range = resolveStatsRange(
      plainToInstance(StatsRangeQuery, { from: '2026-05-01', to: '2026-06-01' }),
      NOW,
    );
    expect(describeRange(range)).toEqual({
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    });
  });

  it.each([
    ['2026-06-01', '2026-05-01'],
    ['2026-05-01', '2026-05-01'],
  ])('refuses from=%s to=%s', (from, to) => {
    expect(() => resolveStatsRange(plainToInstance(StatsRangeQuery, { from, to }), NOW)).toThrow(
      /from must be earlier than to/,
    );
  });

  it(`refuses a window wider than ${MAX_RANGE_DAYS} days`, () => {
    expect(() =>
      resolveStatsRange(
        plainToInstance(StatsRangeQuery, { from: '2024-01-01', to: '2026-01-01' }),
        NOW,
      ),
    ).toThrow(/more than 366 days/);
  });

  it('measures an open ended window against now', () => {
    expect(() =>
      resolveStatsRange(plainToInstance(StatsRangeQuery, { from: '2020-01-01' }), NOW),
    ).toThrow(/more than 366 days/);
    expect(
      resolveStatsRange(plainToInstance(StatsRangeQuery, { from: '2026-01-01' }), NOW).from,
    ).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('leaves an upper bound alone on its own', () => {
    const range = resolveStatsRange(plainToInstance(StatsRangeQuery, { to: '2026-01-01' }), NOW);
    expect(range.from).toBeNull();
    expect(range.to).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});

describe('buckets', () => {
  it.each([
    ['hour', '2026-05-27T13:00:00.000Z'],
    ['day', '2026-05-27T00:00:00.000Z'],
    // A Wednesday, so the week starts on Monday the 25th, as date_trunc does.
    ['week', '2026-05-25T00:00:00.000Z'],
  ] as const)('truncates to the start of the %s', (bucket, expected) => {
    expect(truncateToBucket(NOW, bucket).toISOString()).toBe(expected);
  });

  it('starts the week on Monday even when the moment is a Sunday', () => {
    expect(truncateToBucket(new Date('2026-05-24T23:59:59.000Z'), 'week').toISOString()).toBe(
      '2026-05-18T00:00:00.000Z',
    );
  });

  it.each([
    ['hour', '2026-05-27T14:45:12.000Z'],
    ['day', '2026-05-28T13:45:12.000Z'],
    ['week', '2026-06-03T13:45:12.000Z'],
  ] as const)('adds one %s', (bucket, expected) => {
    expect(addBuckets(NOW, bucket, 1).toISOString()).toBe(expected);
  });

  it('lists every bucket start in the window, including the quiet ones', () => {
    const starts = bucketStarts(
      new Date('2026-05-27T00:00:00.000Z'),
      new Date('2026-05-27T03:30:00.000Z'),
      'hour',
    );
    expect(starts.map((start) => start.toISOString())).toEqual([
      '2026-05-27T00:00:00.000Z',
      '2026-05-27T01:00:00.000Z',
      '2026-05-27T02:00:00.000Z',
      '2026-05-27T03:00:00.000Z',
    ]);
  });

  it('is empty when the window is empty', () => {
    const instant = new Date('2026-05-27T00:00:00.000Z');
    expect(bucketStarts(instant, instant, 'day')).toEqual([]);
  });
});

describe('resolveTrendWindow', () => {
  it('defaults to the most recent buckets, aligned', () => {
    const window = resolveTrendWindow(plainToInstance(StatsTrendQuery, { bucket: 'hour' }), NOW);
    expect(window.from.toISOString()).toBe('2026-05-26T14:00:00.000Z');
    expect(window.to).toEqual(NOW);
    expect(bucketStarts(window.from, window.to, 'hour')).toHaveLength(BUCKET_WINDOWS.hour.default);
  });

  it('defaults to days when no bucket is named', () => {
    expect(resolveTrendWindow(plainToInstance(StatsTrendQuery, {}), NOW).bucket).toBe('day');
  });

  it('aligns the requested start to the bucket', () => {
    const window = resolveTrendWindow(
      plainToInstance(StatsTrendQuery, {
        bucket: 'day',
        from: '2026-05-27T13:00:00Z',
        to: '2026-05-28T13:00:00Z',
      }),
      NOW,
    );
    expect(window.from.toISOString()).toBe('2026-05-27T00:00:00.000Z');
  });

  it.each([
    ['hour', '2026-01-01', '2026-06-01', /at most 744 buckets/],
    ['day', '2024-06-01', '2026-06-01', /at most 366 buckets/],
  ] as const)('refuses too many %s buckets', (bucket, from, to, message) => {
    expect(() =>
      resolveTrendWindow(plainToInstance(StatsTrendQuery, { bucket, from, to }), NOW),
    ).toThrow(message);
  });

  it('refuses a backwards window', () => {
    expect(() =>
      resolveTrendWindow(
        plainToInstance(StatsTrendQuery, { from: '2026-06-01', to: '2026-05-01' }),
        NOW,
      ),
    ).toThrow(/from must be earlier than to/);
  });

  it('refuses a bucket it does not know', async () => {
    const problems = await problemsFor(StatsTrendQuery as typeof StatsRangeQuery, {
      bucket: 'fortnight',
    });
    expect(problems.join(' ')).toContain('bucket must be one of: hour, day, week');
  });

  it('accepts the largest window each bucket allows', () => {
    for (const bucket of ['hour', 'day', 'week'] as const) {
      const to = new Date('2026-06-01T00:00:00.000Z');
      const from = addBuckets(to, bucket, -BUCKET_WINDOWS[bucket].max);
      const window = resolveTrendWindow(
        plainToInstance(StatsTrendQuery, {
          bucket,
          from: from.toISOString(),
          to: to.toISOString(),
        }),
        NOW,
      );
      expect(bucketStarts(window.from, window.to, bucket)).toHaveLength(BUCKET_WINDOWS[bucket].max);
    }
  });
});

describe('reading aggregates back', () => {
  it('treats a sum over no rows as zero', () => {
    expect(energyOrZero(null)).toBe('0.000');
    expect(moneyOrZero(undefined)).toBe('0.00');
  });

  it('keeps the scale of the values it is given', () => {
    expect(energyOrZero('4')).toBe('4.000');
    expect(moneyOrZero('16.005')).toBe('16.01');
    expect(priceOrNull('4.25')).toBe('4.2500');
  });

  it('reports an average over no rows as null, not zero', () => {
    expect(priceOrNull(null)).toBeNull();
    expect(isoOrNull(null)).toBeNull();
  });

  it('renders a timestamp in UTC', () => {
    expect(isoOrNull(NOW)).toBe('2026-05-27T13:45:12.000Z');
  });
});
