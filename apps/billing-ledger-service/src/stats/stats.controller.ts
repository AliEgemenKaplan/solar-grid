import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiPageResponse,
  RequiresOperator,
  StatsRangeQuery,
  StatsTrendQuery,
} from '@solar-grid/nest-common';
import { StatsService } from './stats.service';
import {
  BillingSummaryResponse,
  BillingTrendResponse,
  HouseholdBillingStatsQuery,
  HouseholdBillingStatsResponse,
} from './dto/billing-stats.dto';

/**
 * Billing and ledger statistics. Every query is a SELECT: the ledger is
 * append-only and reading it cannot change that.
 *
 * These are the neighbourhood's finances, so they ask for the operator
 * credentials. A household's own balance and ledger stay where they were.
 */
@ApiTags('Statistics')
@Controller('stats')
@RequiresOperator()
@ApiBadRequestResponse({ type: ApiErrorResponse, description: 'A malformed bound or filter' })
@ApiUnprocessableEntityResponse({
  type: ApiErrorResponse,
  description: 'A window that is backwards or wider than the limit',
})
@ApiServiceUnavailableResponse({
  type: ApiErrorResponse,
  description: 'The database did not answer',
})
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Billing and the ledger in a window',
    description:
      'What was settled, what the ledger recorded and where the balances stand. Trades are counted by when they completed; `from` is inclusive, `to` is exclusive, both UTC.',
  })
  @ApiOkResponse({ type: BillingSummaryResponse })
  summary(@Query() query: StatsRangeQuery): Promise<BillingSummaryResponse> {
    return this.stats.summary(query);
  }

  @Get('households')
  @ApiOperation({
    summary: 'Ledger activity per household, most money moved first',
    description:
      'One row per household with entries in the window. A trade writes one entry for each side, so a household with eight entries was in eight trades.',
  })
  @ApiPageResponse(HouseholdBillingStatsResponse)
  households(@Query() query: HouseholdBillingStatsQuery) {
    return this.stats.households(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Settled trades over time, bucketed',
    description:
      'Hour, day or week buckets in UTC, by when the trade completed. Defaults to the last 24 hours, 30 days or 12 weeks; a window that would need more than 744 hourly, 366 daily or 105 weekly buckets is refused.',
  })
  @ApiOkResponse({ type: BillingTrendResponse })
  trend(@Query() query: StatsTrendQuery): Promise<BillingTrendResponse> {
    return this.stats.trend(query);
  }
}
