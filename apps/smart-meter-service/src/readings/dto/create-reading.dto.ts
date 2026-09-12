import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsDateString, Min } from 'class-validator';

export class CreateReadingDto {
  @ApiProperty({ example: 'HH-001', description: 'Unique household identifier' })
  @IsString()
  householdId: string;

  @ApiProperty({ example: 8.5, description: 'Energy production in kWh' })
  @IsNumber()
  @Min(0)
  productionKwh: number;

  @ApiProperty({ example: 3.2, description: 'Energy consumption in kWh' })
  @IsNumber()
  @Min(0)
  consumptionKwh: number;

  @ApiProperty({
    example: '2026-05-27T10:00:00.000Z',
    description: 'Meter reading timestamp (ISO 8601)',
  })
  @IsDateString()
  timestamp: string;
}
