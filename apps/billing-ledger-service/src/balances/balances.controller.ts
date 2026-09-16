import { Controller, Get, Param } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse, HouseholdIdParam } from '@solar-grid/nest-common';
import { LedgerService } from '../ledger/ledger.service';
import { BalanceResponse } from '../trades/dto/trade.responses';

@ApiTags('Balances')
@Controller('balances')
export class BalancesController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':householdId')
  @ApiOperation({ summary: 'Current balance for a household' })
  @ApiOkResponse({ type: BalanceResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  get(@Param() { householdId }: HouseholdIdParam): Promise<BalanceResponse> {
    return this.ledger.getBalance(householdId);
  }
}
