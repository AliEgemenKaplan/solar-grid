import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ENERGY_SCALE, MONEY_SCALE, PRICE_SCALE } from '@solar-grid/shared-utils';
import { IsDecimalAmount } from '../../common/is-decimal-amount.decorator';

/** The only currency this neighbourhood trades in. */
const SUPPORTED_CURRENCIES = ['TRY'];

export class CreateTradeDto {
  @ApiProperty({ example: 'TRD-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tradeId!: string;

  @ApiProperty({ example: 'HH-SELLER-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sellerHouseholdId!: string;

  @ApiProperty({ example: 'HH-BUYER-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  buyerHouseholdId!: string;

  @ApiProperty({
    example: '4.000',
    description: 'kWh as a decimal string, at most 3 decimal places',
  })
  @IsDecimalAmount({ min: '0.001', max: '1000000', scale: ENERGY_SCALE })
  energyKwh!: string;

  @ApiProperty({
    example: '4.7500',
    description: 'Price per kWh as a decimal string, at most 4 decimal places',
  })
  @IsDecimalAmount({ min: '0.0001', max: '1000000', scale: PRICE_SCALE })
  pricePerKwh!: string;

  @ApiProperty({
    example: '19.00',
    description: 'energyKwh * pricePerKwh as a decimal string, at most 2 decimal places',
  })
  @IsDecimalAmount({ min: '0', max: '1000000000', scale: MONEY_SCALE })
  totalAmount!: string;

  @ApiProperty({ example: 'TRY' })
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @ApiProperty({
    example: 'TRD-001',
    description: 'Stable for the lifetime of the trade; a retry carries the same key',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ example: 'flow-uuid-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  correlationId!: string;

  @ApiProperty({ example: '2026-05-27T10:10:00.000Z' })
  @IsDateString()
  completedAt!: string;
}
