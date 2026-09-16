import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse, ApiPageResponse, HouseholdIdParam } from '@solar-grid/nest-common';
import { LedgerService } from './ledger.service';
import { LedgerEntryResponse, LedgerQuery } from '../trades/dto/trade.responses';

@ApiTags('Ledger')
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':householdId')
  @ApiOperation({ summary: 'Append-only ledger entries for a household, newest first' })
  @ApiPageResponse(LedgerEntryResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Param() { householdId }: HouseholdIdParam, @Query() query: LedgerQuery) {
    return this.ledger.listEntries(householdId, query);
  }
}
