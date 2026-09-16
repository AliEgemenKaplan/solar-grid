import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsString, Matches } from 'class-validator';
import { ENERGY_SCALE, MONEY_SCALE, PRICE_SCALE } from '@solar-grid/shared-utils';
import {
  CORRELATION_ID_PATTERN,
  DecimalAmountField,
  SafeIdentifier,
} from '@solar-grid/nest-common';

/** The only currency this neighbourhood trades in. */
export const SUPPORTED_CURRENCIES = ['TRY'] as const;

/**
 * A completed trade, as trade-matching-service reports it.
 *
 * Nothing here is trusted just because it arrived: the amounts are validated
 * as decimal strings, the total is recomputed from the energy and the price,
 * and a household cannot appear on both sides.
 */
export class CreateTradeDto {
  @SafeIdentifier('Trade identifier', 'TRD-5F1A2B3C4D5E')
  tradeId!: string;

  @SafeIdentifier('Household selling the energy', 'HH-SELLER-001')
  sellerHouseholdId!: string;

  @SafeIdentifier('Household buying the energy', 'HH-BUYER-001')
  buyerHouseholdId!: string;

  @DecimalAmountField({
    min: '0.001',
    max: '1000000',
    scale: ENERGY_SCALE,
    example: '4.000',
    description: 'Energy traded, in kWh',
  })
  energyKwh!: string;

  @DecimalAmountField({
    min: '0.0001',
    max: '1000000',
    scale: PRICE_SCALE,
    example: '4.7500',
    description: 'Price per kWh',
  })
  pricePerKwh!: string;

  @DecimalAmountField({
    min: '0',
    max: '1000000000',
    scale: MONEY_SCALE,
    example: '19.00',
    description: 'energyKwh multiplied by pricePerKwh, rounded half up to 2 decimals',
  })
  totalAmount!: string;

  @ApiProperty({ example: 'TRY', enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @SafeIdentifier(
    'Stable for the lifetime of the trade. A retry carries the same key and the same payload.',
    'TRD-5F1A2B3C4D5E',
  )
  idempotencyKey!: string;

  @ApiProperty({ example: 'demo-flow-001', pattern: CORRELATION_ID_PATTERN.source })
  @IsString()
  @Matches(CORRELATION_ID_PATTERN, {
    message: 'correlationId must be 1-128 characters of letters, digits, ".", "_", ":" or "-"',
  })
  correlationId!: string;

  @ApiProperty({ example: '2026-05-27T10:10:00.000Z', format: 'date-time' })
  @IsDateString({ strict: true })
  completedAt!: string;
}
