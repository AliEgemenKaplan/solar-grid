import { DecimalLike, formatEnergy, formatMoney, formatPrice } from '@solar-grid/shared-utils';

/**
 * Reading SQL aggregates back out.
 *
 * `SUM` over no rows is NULL, not zero, and `AVG`, `MIN` and `MAX` over no
 * rows are NULL as well. The difference matters: a sum of nothing is honestly
 * zero, while an average of nothing is not a number at all and is reported as
 * null rather than invented.
 */

export function energyOrZero(value: DecimalLike | null | undefined): string {
  return formatEnergy(value ?? 0);
}

export function moneyOrZero(value: DecimalLike | null | undefined): string {
  return formatMoney(value ?? 0);
}

export function priceOrNull(value: DecimalLike | null | undefined): string | null {
  return value === null || value === undefined ? null : formatPrice(value);
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
