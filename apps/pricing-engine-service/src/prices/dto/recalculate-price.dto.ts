import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

/** Neighbourhood level aggregates, not a national grid. */
const MAX_NEIGHBOURHOOD_KWH = 10_000_000;

export class RecalculatePriceDto {
  @ApiProperty({ example: 50, description: 'Total supply in kWh across the neighborhood' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_NEIGHBOURHOOD_KWH)
  totalSupplyKwh!: number;

  @ApiProperty({ example: 40, description: 'Total demand in kWh across the neighborhood' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_NEIGHBOURHOOD_KWH)
  totalDemandKwh!: number;
}
