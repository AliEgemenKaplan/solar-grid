import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CorrelationIdFilter, PaginationQuery } from '@solar-grid/nest-common';

export const TRADE_STATUSES = ['PENDING_BILLING', 'COMPLETED', 'FAILED'] as const;
export const OFFER_STATUSES = ['OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'CANCELLED'] as const;

export class TradeMatchResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TRD-5F1A2B3C4D5E' }) tradeId!: string;
  @ApiProperty() sellerHouseholdId!: string;
  @ApiProperty() buyerHouseholdId!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '4.000' }) energyKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '4.0000' }) pricePerKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '16.00' }) totalAmount!: string;
  @ApiProperty({ example: 'TRY' }) currency!: string;
  @ApiProperty({ enum: TRADE_STATUSES }) status!: string;
  @ApiPropertyOptional({ nullable: true }) billingTradeId!: string | null;
  @ApiProperty() offerId!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() idempotencyKey!: string;
  @ApiProperty() billingAttempts!: number;
  @ApiProperty() correlationId!: string;
  @ApiPropertyOptional({ nullable: true }) failureReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class OfferResponse {
  @ApiProperty() id!: string;
  @ApiProperty() householdId!: string;
  @ApiPropertyOptional({ nullable: true }) sourceEventId!: string | null;
  @ApiProperty({ type: String, format: 'decimal', example: '3.000' }) availableKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '7.000' }) originalKwh!: string;
  @ApiProperty({ enum: OFFER_STATUSES }) status!: string;
  @ApiProperty() correlationId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class RequestResponse {
  @ApiProperty() id!: string;
  @ApiProperty() householdId!: string;
  @ApiPropertyOptional({ nullable: true }) sourceEventId!: string | null;
  @ApiProperty({ type: String, format: 'decimal', example: '0.000' }) requestedKwh!: string;
  @ApiProperty({ type: String, format: 'decimal', example: '4.000' }) originalKwh!: string;
  @ApiProperty({ enum: OFFER_STATUSES }) status!: string;
  @ApiProperty() correlationId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class MatchRunResponse {
  @ApiProperty({ description: 'Trades reserved and billed during this run' }) matched!: number;
  @ApiProperty({ description: 'Trades billing refused; their energy was released' })
  failed!: number;
  @ApiProperty({ description: 'Pairs skipped because a household would trade with itself' })
  skipped!: number;
  @ApiProperty({ description: 'Trades reserved whose billing answer never arrived' })
  pending!: number;
  @ApiProperty({ description: 'Trades from earlier runs confirmed during this one' })
  settled!: number;
}

export class MatchListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: TRADE_STATUSES })
  @IsOptional()
  @IsIn(TRADE_STATUSES)
  status?: (typeof TRADE_STATUSES)[number];

  @CorrelationIdFilter()
  correlationId?: string;
}

export class OfferListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: OFFER_STATUSES })
  @IsOptional()
  @IsIn(OFFER_STATUSES)
  status?: (typeof OFFER_STATUSES)[number];

  @CorrelationIdFilter()
  correlationId?: string;
}
