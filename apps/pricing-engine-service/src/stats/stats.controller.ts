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
  RequiresOperator,
  StatsRangeQuery,
  StatsTrendQuery,
} from '@solar-grid/nest-common';
import { StatsService } from './stats.service';
import { PriceSummaryResponse, PriceTrendResponse } from './dto/price-stats.dto';

/**
 * Price statistics. Nothing here recalculates a price: these endpoints read
 * the snapshots that were recorded when it was.
 *
 * The current price is public, because every household needs it. How the
 * price has moved, and the supply and demand behind it, is operational
 * information and asks for the operator credentials.
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
    summary: 'Prices in a window',
    description:
      'How many prices were calculated, their average, lowest and highest, the supply and demand behind them, and the band in force. `from` is inclusive, `to` is exclusive, both UTC.',
  })
  @ApiOkResponse({ type: PriceSummaryResponse })
  summary(@Query() query: StatsRangeQuery): Promise<PriceSummaryResponse> {
    return this.stats.summary(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Prices over time, bucketed',
    description:
      'Hour, day or week buckets in UTC. Defaults to the last 24 hours, 30 days or 12 weeks; a window that would need more than 744 hourly, 366 daily or 105 weekly buckets is refused.',
  })
  @ApiOkResponse({ type: PriceTrendResponse })
  trend(@Query() query: StatsTrendQuery): Promise<PriceTrendResponse> {
    return this.stats.trend(query);
  }
}
