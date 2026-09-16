import { ApiProperty } from '@nestjs/swagger';

export class PriceResponse {
  @ApiProperty({ type: String, format: 'decimal', example: '4.0000', description: 'TRY per kWh' })
  pricePerKwh!: string;

  @ApiProperty({ example: 'TRY' })
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  calculatedAt!: string;

  @ApiProperty({ type: String, format: 'decimal', example: '50.000' })
  supplyKwh!: string;

  @ApiProperty({ type: String, format: 'decimal', example: '40.000' })
  demandKwh!: string;
}

export class PriceSnapshotResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '50.000' }) totalSupplyKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '40.000' }) totalDemandKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '3.2000' }) calculatedPrice!: string;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
