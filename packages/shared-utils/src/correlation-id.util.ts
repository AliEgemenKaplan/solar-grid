import { randomUUID } from 'node:crypto';

const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * A correlation id ends up in log lines, in AMQP properties and in database
 * columns, so it is not left as whatever the caller sent. Letters, digits and
 * a few separators are enough to express a UUID, a trace id or a human label,
 * and the length is bounded.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Returns the value if it can be used as a correlation id, otherwise null.
 * Callers decide whether to replace it or to reject the request.
 */
export function normalizeCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SAFE_CORRELATION_ID.test(trimmed) ? trimmed : null;
}

/**
 * The correlation id from the request, or a fresh one.
 *
 * An unusable value is replaced rather than trusted or truncated: a truncated
 * id would silently point at the wrong trace, and an unbounded one would end
 * up in every log line and every row this operation writes.
 */
export function getOrGenerateCorrelationId(
  headers?: Record<string, string | string[] | undefined>,
): string {
  const raw = headers?.[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return normalizeCorrelationId(candidate) ?? randomUUID();
}
