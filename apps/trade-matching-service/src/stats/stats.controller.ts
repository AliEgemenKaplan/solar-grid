import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
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
  HouseholdTradeStatsQuery,
  HouseholdTradeStatsResponse,
  TradeSummaryResponse,
  TradeTrendResponse,
} from './dto/trade-stats.dto';

/**
 * Market statistics. Nothing here writes, and nothing here runs matching:
 * these endpoints read the offers, requests and trades as they stand.
 *
 * They describe the whole neighbourhood's trading, which is commercially
 * interesting, so they ask for the operator credentials rather than being
 * open the way a single trade lookup is.
 */
@ApiTags('Statistics')
@Controller('stats')
@RequiresOperator()
@ApiBadRequestResponse({ type: ApiErrorResponse, description: 'A malformed bound or filter' })
@ApiUnprocessableEntityResponse({
  type: ApiErrorResponse,
  description: 'A window that is backwards or wider than the limit',
})
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Trading in a window',
    description:
      'Trades by outcome, the energy and money they moved, and how much of what was offered or wanted found a counterparty. `from` is inclusive, `to` is exclusive, both UTC; with neither, everything is read.',
  })
  @ApiOkResponse({ type: TradeSummaryResponse })
  summary(@Query() query: StatsRangeQuery): Promise<TradeSummaryResponse> {
    return this.stats.summary(query);
  }

  @Get('households')
  @ApiOperation({
    summary: 'Completed trading per household, busiest by money first',
    description:
      'Counts a household once as a seller and once as a buyer. Only completed trades are included; a reservation that has not settled is not trading yet.',
  })
  @ApiPageResponse(HouseholdTradeStatsResponse)
  households(@Query() query: HouseholdTradeStatsQuery) {
    return this.stats.households(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Trading over time, bucketed',
    description:
      'Hour, day or week buckets in UTC, by when the trade was created. Defaults to the last 24 hours, 30 days or 12 weeks; a window that would need more than 744 hourly, 366 daily or 105 weekly buckets is refused.',
  })
  @ApiOkResponse({ type: TradeTrendResponse })
  trend(@Query() query: StatsTrendQuery): Promise<TradeTrendResponse> {
    return this.stats.trend(query);
  }
}
