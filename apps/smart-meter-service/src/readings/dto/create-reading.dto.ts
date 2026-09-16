import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { PaginationQuery, SafeIdentifier } from '@solar-grid/nest-common';

/** No household meter reports anywhere near this in one interval. */
export const MAX_READING_KWH = 1_000_000;

export const ENERGY_STATUSES = ['SURPLUS', 'DEMAND', 'BALANCED'] as const;

/**
 * A meter reading. Production and consumption stay JSON numbers on the way
 * in: they are measurements from an instrument, bounded here and converted to
 * exact decimals on arrival. Everything returned is a decimal string.
 */
export class CreateReadingDto {
  @SafeIdentifier('Household the meter belongs to', 'HH-SELLER-001')
  householdId!: string;

  @ApiProperty({
    example: 8.5,
    minimum: 0,
    maximum: MAX_READING_KWH,
    description: 'kWh produced, at most 3 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_READING_KWH)
  productionKwh!: number;

  @ApiProperty({
    example: 3.2,
    minimum: 0,
    maximum: MAX_READING_KWH,
    description: 'kWh consumed, at most 3 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_READING_KWH)
  consumptionKwh!: number;

  @ApiProperty({
    example: '2026-05-27T10:00:00.000Z',
    format: 'date-time',
    description: 'When the meter took the reading. Must not be in the future.',
  })
  @IsDateString({ strict: true })
  timestamp!: string;
}

export class ReadingSummary {
  @ApiProperty() id!: string;
  @ApiProperty() householdId!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '10.000' }) productionKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '3.000' }) consumptionKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '7.000' }) netKwh!: string;
  @ApiProperty({ enum: ENERGY_STATUSES }) status!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ReadingResponse extends ReadingSummary {
  @ApiProperty({ type: String, format: 'decimal', example: '7.000' }) surplusKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '0.000' }) demandKwh!: string;

  @ApiProperty({
    description:
      'True when this household already reported a reading for this timestamp; no second event was published',
  })
  duplicate!: boolean;
}

export class HouseholdStatusResponse {
  @ApiProperty() householdId!: string;
  @ApiProperty({ enum: ENERGY_STATUSES }) currentStatus!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '7.000' }) currentSurplusKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '0.000' }) currentDemandKwh!: string;
  @ApiProperty({
    format: 'date-time',
    description: 'Timestamp of the reading this status came from',
  })
  lastReadingAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class HouseholdListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ENERGY_STATUSES })
  @IsOptional()
  @IsIn(ENERGY_STATUSES)
  status?: (typeof ENERGY_STATUSES)[number];
}
