export interface PriceResponseDto {
  pricePerKwh: number;
  currency: string;
  calculatedAt: string;
  supplyKwh: number;
  demandKwh: number;
}
