import Decimal from 'decimal.js';

/**
 * Anything that carries an exact decimal value: a Prisma Decimal, a decimal
 * string, or a plain number. Prisma hands back Decimal objects, services pass
 * strings between each other, and DTOs still accept numbers.
 */
export type DecimalLike = string | number | { toString(): string };

/** Kilowatt hours, to the watt hour. */
export const ENERGY_SCALE = 3;
/** Price per kilowatt hour. */
export const PRICE_SCALE = 4;
/** Money, to the kurus. */
export const MONEY_SCALE = 2;

/**
 * Renders a value as a fixed-scale decimal string.
 *
 * Going through the string form matters: Prisma Decimal and decimal.js here
 * are separate copies of the same library, and a number would lose exactness
 * on the way in. This is what every API response uses, so a consumer always
 * sees the same shape and can parse it with a decimal type of its own rather
 * than a double.
 */
export function formatDecimal(value: DecimalLike, scale: number): string {
  return new Decimal(String(value)).toFixed(scale);
}

export function formatEnergy(value: DecimalLike): string {
  return formatDecimal(value, ENERGY_SCALE);
}

export function formatPrice(value: DecimalLike): string {
  return formatDecimal(value, PRICE_SCALE);
}

export function formatMoney(value: DecimalLike): string {
  return formatDecimal(value, MONEY_SCALE);
}

/** True when the value is a finite decimal within the given bounds. */
export function isDecimalWithin(
  value: DecimalLike,
  min: Decimal.Value,
  max: Decimal.Value,
): boolean {
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    return false;
  }
  return parsed.isFinite() && parsed.gte(min) && parsed.lte(max);
}
