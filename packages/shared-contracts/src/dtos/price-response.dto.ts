/**
 * Decimal values cross service boundaries as strings with a fixed scale.
 *
 * A JSON number is a double, and a double cannot hold 4.0001 or 0.1 exactly.
 * Sending the decimal as text means neither side has to round on the way in,
 * and every service can parse it into whatever exact type it uses.
 */
export interface PriceResponseDto {
  /** Price per kWh, 4 decimals, e.g. "4.0000". */
  pricePerKwh: string;
  /** ISO currency code, e.g. "TRY". */
  currency: string;
  calculatedAt: string;
  /** kWh, 3 decimals. */
  supplyKwh: string;
  /** kWh, 3 decimals. */
  demandKwh: string;
}
