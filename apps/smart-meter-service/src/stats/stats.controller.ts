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
  EnergySummaryResponse,
  EnergyTrendResponse,
  HouseholdEnergyStatsQuery,
  HouseholdEnergyStatsResponse,
} from './dto/energy-stats.dto';

/**
 * Neighbourhood level energy statistics. Nothing here writes.
 *
 * A single household can read its own readings without a token, but these
 * endpoints describe the whole neighbourhood - who produces, who consumes,
 * when it peaks - which is operational information, so they ask for the
 * operator credentials.
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
    summary: 'Energy recorded in a window',
    description:
      'Totals over the meter readings. `from` is inclusive, `to` is exclusive, both UTC; with neither, the whole history is read.',
  })
  @ApiOkResponse({ type: EnergySummaryResponse })
  summary(@Query() query: StatsRangeQuery): Promise<EnergySummaryResponse> {
    return this.stats.summary(query);
  }

  @Get('households')
  @ApiOperation({
    summary: 'Energy per household, biggest producer first',
    description: 'Households with no readings in the window are not listed.',
  })
  @ApiPageResponse(HouseholdEnergyStatsResponse)
  households(@Query() query: HouseholdEnergyStatsQuery) {
    return this.stats.households(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Energy over time, bucketed',
    description:
      'Hour, day or week buckets in UTC. Defaults to the last 24 hours, 30 days or 12 weeks; a window that would need more than 744 hourly, 366 daily or 105 weekly buckets is refused.',
  })
  @ApiOkResponse({ type: EnergyTrendResponse })
  trend(@Query() query: StatsTrendQuery): Promise<EnergyTrendResponse> {
    return this.stats.trend(query);
  }
}
