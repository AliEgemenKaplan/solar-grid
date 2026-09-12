import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateTradeId(): string {
  return `TRD-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
}

export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  const combined = [prefix, ...parts].join('-');
  return `${combined}-${uuidv4().split('-')[0]}`;
}
