import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Identifiers that come from outside - household ids, trade ids - end up in
 * URLs, log lines and database lookups. Letters, digits and a few separators
 * cover every id this system generates or a meter would plausibly send.
 */
export const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Same alphabet as SAFE_IDENTIFIER_PATTERN, with room for a UUID plus a prefix. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function SafeIdentifier(description: string, example: string) {
  return applyDecorators(
    ApiProperty({ description, example, pattern: SAFE_IDENTIFIER_PATTERN.source, maxLength: 64 }),
    IsString(),
    Matches(SAFE_IDENTIFIER_PATTERN, {
      message: '$property must be 1-64 characters of letters, digits, ".", "_", ":" or "-"',
    }),
  );
}

export class HouseholdIdParam {
  @SafeIdentifier('Household identifier', 'HH-SELLER-001')
  householdId!: string;
}

export class TradeIdParam {
  @SafeIdentifier('Trade identifier', 'TRD-5F1A2B3C4D5E')
  tradeId!: string;
}

/** An optional correlation id filter for list endpoints. */
export function CorrelationIdFilter() {
  return applyDecorators(
    ApiPropertyOptional({
      description: 'Only return records created by the operation with this correlation id',
      example: 'demo-flow-001',
      pattern: CORRELATION_ID_PATTERN.source,
      maxLength: 128,
    }),
    IsOptional(),
    IsString(),
    Matches(CORRELATION_ID_PATTERN, {
      message: 'correlationId must be 1-128 characters of letters, digits, ".", "_", ":" or "-"',
    }),
  );
}

/** An optional household filter for list and statistics endpoints. */
export function HouseholdIdFilter(description = 'Only include this household') {
  return applyDecorators(
    ApiPropertyOptional({
      description,
      example: 'HH-SELLER-001',
      pattern: SAFE_IDENTIFIER_PATTERN.source,
      maxLength: 64,
    }),
    IsOptional(),
    IsString(),
    Matches(SAFE_IDENTIFIER_PATTERN, {
      message: 'householdId must be 1-64 characters of letters, digits, ".", "_", ":" or "-"',
    }),
  );
}
