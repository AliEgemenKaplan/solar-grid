import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { formatEnergy, formatMoney, formatPrice, MONEY_SCALE } from '@solar-grid/shared-utils';
import type { CreateTradeDto } from './dto/create-trade.dto';

/**
 * A fingerprint of what a trade request asks for, independent of how it was
 * written.
 *
 * Two requests that mean the same trade must hash the same even if one sends
 * "4.0" and the other "4.000", lists its fields in a different order, or
 * writes the completion time with a different offset. So the hash is taken
 * over a canonical form: fixed field order, decimals at their column scale,
 * the timestamp in UTC.
 *
 * The correlation id is deliberately left out. It identifies the operation
 * that sent the request, not the trade, and a legitimate retry from a
 * different trace must not be mistaken for a different trade.
 */
export function tradeRequestFingerprint(dto: CreateTradeDto): string {
  const canonical = [
    dto.tradeId,
    dto.sellerHouseholdId,
    dto.buyerHouseholdId,
    formatEnergy(dto.energyKwh),
    formatPrice(dto.pricePerKwh),
    formatMoney(dto.totalAmount),
    dto.currency.toUpperCase(),
    new Date(dto.completedAt).toISOString(),
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * The total the trade should carry. Billing recomputes it rather than taking
 * the caller's word, since it is the number that moves money.
 */
export function expectedTotal(energyKwh: string, pricePerKwh: string): string {
  return new Decimal(energyKwh).mul(pricePerKwh).toFixed(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** The fields that differ between a stored trade and a new request, for the 409 body. */
export function differingFields(
  stored: {
    sellerHouseholdId: string;
    buyerHouseholdId: string;
    energyKwh: { toString(): string };
    pricePerKwh: { toString(): string };
    totalAmount: { toString(): string };
    currency: string;
    tradeId: string;
    completedAt: Date;
  },
  dto: CreateTradeDto,
): string[] {
  const differences: string[] = [];
  if (stored.tradeId !== dto.tradeId) differences.push('tradeId');
  if (stored.sellerHouseholdId !== dto.sellerHouseholdId) differences.push('sellerHouseholdId');
  if (stored.buyerHouseholdId !== dto.buyerHouseholdId) differences.push('buyerHouseholdId');
  if (formatEnergy(stored.energyKwh) !== formatEnergy(dto.energyKwh)) differences.push('energyKwh');
  if (formatPrice(stored.pricePerKwh) !== formatPrice(dto.pricePerKwh))
    differences.push('pricePerKwh');
  if (formatMoney(stored.totalAmount) !== formatMoney(dto.totalAmount))
    differences.push('totalAmount');
  if (stored.currency !== dto.currency.toUpperCase()) differences.push('currency');
  if (stored.completedAt.toISOString() !== new Date(dto.completedAt).toISOString()) {
    differences.push('completedAt');
  }
  return differences;
}
