import { randomUUID } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

export function generateTradeId(): string {
  return `TRD-${randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
}

export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  const combined = [prefix, ...parts].join('-');
  return `${combined}-${randomUUID().split('-')[0]}`;
}
