import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsDateString, Min, IsPositive } from 'class-validator';

export class CreateTradeDto {
  @ApiProperty({ example: 'TRD-001' })
  @IsString()
  tradeId!: string;

  @ApiProperty({ example: 'HH-SELLER-001' })
  @IsString()
  sellerHouseholdId!: string;

  @ApiProperty({ example: 'HH-BUYER-001' })
  @IsString()
  buyerHouseholdId!: string;

  @ApiProperty({ example: 4 })
  @IsNumber()
  @IsPositive()
  energyKwh!: number;

  @ApiProperty({ example: 4.75 })
  @IsNumber()
  @IsPositive()
  pricePerKwh!: number;

  @ApiProperty({ example: 19 })
  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @ApiProperty({ example: 'TRY' })
  @IsString()
  currency!: string;

  @ApiProperty({
    example: 'match-uuid-001',
    description: 'Unique key to prevent duplicate ledger entries',
  })
  @IsString()
  idempotencyKey!: string;

  @ApiProperty({ example: 'flow-uuid-001' })
  @IsString()
  correlationId!: string;

  @ApiProperty({ example: '2026-05-27T10:10:00.000Z' })
  @IsDateString()
  completedAt!: string;
}
