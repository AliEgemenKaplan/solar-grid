import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

/** No household meter reports anywhere near this in one interval. */
const MAX_READING_KWH = 1_000_000;

export class CreateReadingDto {
  @ApiProperty({ example: 'HH-001', description: 'Unique household identifier' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  householdId!: string;

  @ApiProperty({ example: 8.5, description: 'Energy production in kWh' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_READING_KWH)
  productionKwh!: number;

  @ApiProperty({ example: 3.2, description: 'Energy consumption in kWh' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_READING_KWH)
  consumptionKwh!: number;

  @ApiProperty({
    example: '2026-05-27T10:00:00.000Z',
    description: 'Meter reading timestamp (ISO 8601)',
  })
  @IsDateString()
  timestamp!: string;
}
