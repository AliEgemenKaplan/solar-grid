import { v4 as uuidv4 } from 'uuid';

const CORRELATION_ID_HEADER = 'x-correlation-id';

export function getOrGenerateCorrelationId(headers?: Record<string, string | string[]>): string {
  if (headers) {
    const value = headers[CORRELATION_ID_HEADER];
    if (value) return Array.isArray(value) ? value[0] : value;
  }
  return uuidv4();
}

export function generateCorrelationId(): string {
  return uuidv4();
}
