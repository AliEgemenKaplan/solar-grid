import { ConfigService } from '@nestjs/config';

export interface RetryConfig {
  /** How many times a failing message is retried before it is parked. */
  maxRetries: number;
  /** Delay before the first retry; each further attempt doubles it. */
  baseDelayMs: number;
  /** Unacknowledged messages allowed per consumer. */
  prefetch: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_PREFETCH = 1;

/** Every retry attempt needs its own queue, so this caps how many we declare. */
const MAX_SUPPORTED_RETRIES = 10;

export function readRetryConfig(config: ConfigService): RetryConfig {
  return {
    maxRetries: bounded(
      config.get<string>('RABBITMQ_MAX_RETRIES', String(DEFAULT_MAX_RETRIES)),
      DEFAULT_MAX_RETRIES,
      0,
      MAX_SUPPORTED_RETRIES,
    ),
    baseDelayMs: bounded(
      config.get<string>('RABBITMQ_RETRY_DELAY_MS', String(DEFAULT_RETRY_DELAY_MS)),
      DEFAULT_RETRY_DELAY_MS,
      1,
      60 * 60 * 1000,
    ),
    prefetch: bounded(
      config.get<string>('RABBITMQ_PREFETCH', String(DEFAULT_PREFETCH)),
      DEFAULT_PREFETCH,
      1,
      100,
    ),
  };
}

/**
 * Backoff doubles with each attempt: 2s, 4s, 8s with the default base. A
 * transient failure usually clears on the first retry, and a dependency that
 * is properly down is not helped by hammering it.
 */
export function retryDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
