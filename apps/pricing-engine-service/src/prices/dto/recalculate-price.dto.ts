import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class RecalculatePriceDto {
  @ApiProperty({ example: 50, description: 'Total supply in kWh across the neighborhood' })
  @IsNumber()
  @Min(0)
  totalSupplyKwh!: number;

  @ApiProperty({ example: 40, description: 'Total demand in kWh across the neighborhood' })
  @IsNumber()
  @Min(0)
  totalDemandKwh!: number;
}
