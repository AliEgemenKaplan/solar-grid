export interface CompletedTradeDto {
  tradeId: string;
  sellerHouseholdId: string;
  buyerHouseholdId: string;
  energyKwh: number;
  pricePerKwh: number;
  totalAmount: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  completedAt: string;
}
