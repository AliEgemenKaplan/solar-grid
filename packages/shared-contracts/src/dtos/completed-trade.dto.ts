/**
 * What trade-matching-service sends to billing-ledger-service.
 *
 * Money and energy are decimal strings with a fixed scale, not JSON numbers:
 * this is the financial boundary of the system and a double cannot represent
 * every amount exactly. See PriceResponseDto for the reasoning.
 */
export interface CompletedTradeDto {
  tradeId: string;
  sellerHouseholdId: string;
  buyerHouseholdId: string;
  /** kWh, 3 decimals, e.g. "4.000". */
  energyKwh: string;
  /** Price per kWh, 4 decimals, e.g. "4.0000". */
  pricePerKwh: string;
  /** energyKwh * pricePerKwh, 2 decimals, e.g. "16.00". */
  totalAmount: string;
  /** ISO currency code, e.g. "TRY". */
  currency: string;
  /**
   * Stable for the lifetime of the trade. Every retry of the same trade
   * carries the same key, which is how billing tells a retry from a new
   * trade.
   */
  idempotencyKey: string;
  correlationId: string;
  completedAt: string;
}
