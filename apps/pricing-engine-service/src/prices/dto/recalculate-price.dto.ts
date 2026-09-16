import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

/** Neighbourhood level aggregates, not a national grid. */
export const MAX_NEIGHBOURHOOD_KWH = 10_000_000;

export class RecalculatePriceDto {
  @ApiProperty({
    example: 50,
    minimum: 0,
    maximum: MAX_NEIGHBOURHOOD_KWH,
    description: 'Total supply across the neighbourhood in kWh, at most 3 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_NEIGHBOURHOOD_KWH)
  totalSupplyKwh!: number;

  @ApiProperty({
    example: 40,
    minimum: 0,
    maximum: MAX_NEIGHBOURHOOD_KWH,
    description: 'Total demand across the neighbourhood in kWh, at most 3 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_NEIGHBOURHOOD_KWH)
  totalDemandKwh!: number;
}
