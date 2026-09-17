import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, registerDecorator } from 'class-validator';
import { BusinessRuleViolationException } from '../errors/api-error';

/**
 * Time handling for the statistics endpoints.
 *
 * Everything here is UTC. The database stores naive timestamps that are
 * already UTC, so a bound is sent to Postgres as an ISO string and compared
 * against the stored wall clock; nothing depends on the session time zone of
 * the server or on the time zone of the machine running Node.
 */

/**
 * A date, or a date and time with an explicit offset. A time without an
 * offset ("2026-05-27T10:00:00") is refused on purpose: JavaScript reads it
 * as local time and Postgres as UTC, and a statistic that quietly shifts by
 * the reader's time zone is worse than an error message.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** Why a bound was refused, or null when it is usable. */
export function instantProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be an ISO-8601 date or date-time string';
  if (!ISO_INSTANT.test(value)) {
    return 'must be an ISO-8601 UTC instant such as "2026-05-27" or "2026-05-27T10:00:00Z"';
  }
  return Number.isNaN(Date.parse(value)) ? 'is not a real date' : null;
}

/** A date-only value means midnight UTC; an offset is honoured. */
export function parseInstant(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

function IsIsoInstant(): PropertyDecorator {
  return function (object: object, propertyKey: string | symbol) {
    const propertyName = String(propertyKey);
    registerDecorator({
      name: 'isIsoInstant',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) => instantProblem(value) === null,
        defaultMessage: (args) =>
          `${propertyName} ${instantProblem(args?.value) ?? 'is not a valid instant'}`,
      },
    });
  };
}

function InstantField(description: string, example: string) {
  return applyDecorators(
    ApiPropertyOptional({ description, example, format: 'date-time' }),
    IsOptional(),
    IsIsoInstant(),
  );
}

/**
 * `?from=&to=`, half open: `from` is included, `to` is not. Adjacent windows
 * therefore tile without counting a row twice, which matters as soon as
 * anyone adds up two months.
 */
export class StatsRangeQuery {
  @InstantField('Include records from this instant (inclusive, UTC)', '2026-05-01')
  from?: string;

  @InstantField('Include records before this instant (exclusive, UTC)', '2026-06-01')
  to?: string;
}

export const TIME_BUCKETS = ['hour', 'day', 'week'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

/**
 * How far a single request may reach, per bucket, and how much it covers when
 * the caller names no window at all. The ceilings are what stop one request
 * asking for a hundred thousand rows; the defaults are what a dashboard
 * usually wants.
 */
export const BUCKET_WINDOWS: Record<TimeBucket, { max: number; default: number }> = {
  hour: { max: 744, default: 24 },
  day: { max: 366, default: 30 },
  week: { max: 105, default: 12 },
};

export class StatsTrendQuery extends StatsRangeQuery {
  @ApiPropertyOptional({ enum: TIME_BUCKETS, default: 'day' })
  @IsOptional()
  @IsIn(TIME_BUCKETS, { message: `bucket must be one of: ${TIME_BUCKETS.join(', ')}` })
  bucket: TimeBucket = 'day';
}

/** An explicit lower bound keeps the window to a year and a day. */
export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The window a query asks for. Null means unbounded on that side. */
export interface ResolvedRange {
  from: Date | null;
  to: Date | null;
}

/** The window actually used by a trend, always bounded and bucket aligned. */
export interface ResolvedWindow {
  from: Date;
  to: Date;
  bucket: TimeBucket;
}

/**
 * Turns the query into a window, or refuses it.
 *
 * A request with no `from` covers everything recorded, which is one indexed
 * aggregate either way. Once a caller names a lower bound the window is
 * capped, so nobody can ask for a range that has to be scanned a year at a
 * time and then bucketed.
 */
export function resolveStatsRange(query: StatsRangeQuery, now: Date = new Date()): ResolvedRange {
  const from = query.from ? parseInstant(query.from) : null;
  const to = query.to ? parseInstant(query.to) : null;

  if (from && to && from.getTime() >= to.getTime()) {
    throw new BusinessRuleViolationException('from must be earlier than to.');
  }
  if (from) {
    const spanDays = ((to ?? now).getTime() - from.getTime()) / DAY_MS;
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BusinessRuleViolationException(
        `The window from ${from.toISOString()} covers more than ${MAX_RANGE_DAYS} days. Narrow it, or ask for a later "from".`,
      );
    }
  }
  return { from, to };
}

/** The start of the bucket a moment falls in, in UTC. Mirrors date_trunc. */
export function truncateToBucket(date: Date, bucket: TimeBucket): Date {
  const start = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      bucket === 'hour' ? date.getUTCHours() : 0,
    ),
  );
  if (bucket === 'week') {
    // date_trunc('week') is the Monday, and so is this.
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  }
  return start;
}

export function addBuckets(date: Date, bucket: TimeBucket, count: number): Date {
  const moved = new Date(date.getTime());
  if (bucket === 'hour') moved.setUTCHours(moved.getUTCHours() + count);
  else moved.setUTCDate(moved.getUTCDate() + count * (bucket === 'week' ? 7 : 1));
  return moved;
}

/**
 * The window a trend covers: what was asked for, aligned to whole buckets,
 * defaulted when absent and refused when it would produce more buckets than
 * the bucket size allows.
 */
export function resolveTrendWindow(query: StatsTrendQuery, now: Date = new Date()): ResolvedWindow {
  const bucket = query.bucket ?? 'day';
  const limits = BUCKET_WINDOWS[bucket];
  const to = query.to ? parseInstant(query.to) : now;
  const from = query.from
    ? parseInstant(query.from)
    : addBuckets(truncateToBucket(to, bucket), bucket, -(limits.default - 1));

  if (from.getTime() >= to.getTime()) {
    throw new BusinessRuleViolationException('from must be earlier than to.');
  }

  const start = truncateToBucket(from, bucket);
  if (bucketStarts(start, to, bucket).length > limits.max) {
    throw new BusinessRuleViolationException(
      `A ${bucket} trend covers at most ${limits.max} buckets. Narrow the window, or ask for a larger bucket.`,
    );
  }
  return { from: start, to, bucket };
}

/**
 * Every bucket start in the window, so a trend can report the quiet ones as
 * zero instead of leaving a hole a chart would draw straight through.
 */
export function bucketStarts(from: Date, to: Date, bucket: TimeBucket): Date[] {
  const starts: Date[] = [];
  const limit = BUCKET_WINDOWS[bucket].max;
  let cursor = truncateToBucket(from, bucket);
  while (cursor.getTime() < to.getTime() && starts.length <= limit) {
    starts.push(cursor);
    cursor = addBuckets(cursor, bucket, 1);
  }
  return starts;
}

/** The window a response was built from, echoed back so a chart can label itself. */
export class StatsRangeResponse {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Inclusive lower bound, or null when the whole history was read',
  })
  from!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Exclusive upper bound, or null when there was none',
  })
  to!: string | null;
}

export function describeRange(range: ResolvedRange): StatsRangeResponse {
  return {
    from: range.from ? range.from.toISOString() : null,
    to: range.to ? range.to.toISOString() : null,
  };
}
