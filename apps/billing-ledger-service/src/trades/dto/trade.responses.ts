import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  CorrelationIdFilter,
  PaginationQuery,
  SAFE_IDENTIFIER_PATTERN,
} from '@solar-grid/nest-common';
import { Matches } from 'class-validator';

export class CompletedTradeResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TRD-5F1A2B3C4D5E' }) tradeId!: string;
  @ApiProperty({ example: 'HH-SELLER-001' }) sellerHouseholdId!: string;
  @ApiProperty({ example: 'HH-BUYER-001' }) buyerHouseholdId!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '4.000' }) energyKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '4.7500' }) pricePerKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '19.00' }) totalAmount!: string;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty() idempotencyKey!: string;
  @ApiProperty() correlationId!: string;
  @ApiProperty({ format: 'date-time' }) completedAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  @ApiProperty({
    description:
      'True when this key had already been recorded with the same payload and the stored trade is being returned',
  })
  duplicate!: boolean;
}

export class LedgerEntryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() tradeId!: string;
  @ApiProperty() householdId!: string;
  @ApiProperty({ enum: ['CREDIT', 'DEBIT'] }) entryType!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '19.00' }) amount!: string;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty() correlationId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class BalanceResponse {
  @ApiProperty() householdId!: string;

  @ApiProperty({
    type: String,
    format: 'decimal',
    example: '16.00',
    description: 'Positive for a net seller, negative for a net buyer, "0.00" with no trades yet',
  })
  balance!: string;

  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class TradeListQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description: 'Only trades where this household is the seller or the buyer',
    pattern: SAFE_IDENTIFIER_PATTERN.source,
  })
  @IsOptional()
  @Matches(SAFE_IDENTIFIER_PATTERN, { message: 'householdId has an invalid format' })
  householdId?: string;

  @CorrelationIdFilter()
  correlationId?: string;
}

export class LedgerQuery extends PaginationQuery {
  @CorrelationIdFilter()
  correlationId?: string;
}
