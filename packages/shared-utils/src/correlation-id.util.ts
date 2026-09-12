import { randomUUID } from 'node:crypto';

const CORRELATION_ID_HEADER = 'x-correlation-id';

export function getOrGenerateCorrelationId(
  headers?: Record<string, string | string[] | undefined>,
): string {
  if (headers) {
    const value = headers[CORRELATION_ID_HEADER];
    if (value) return Array.isArray(value) ? value[0] : value;
  }
  return randomUUID();
}
