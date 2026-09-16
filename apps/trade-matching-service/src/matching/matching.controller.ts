import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiPageResponse,
  CorrelationId,
  DownstreamUnavailableException,
  RequiresOperator,
  TradeIdParam,
  WriteRateLimit,
} from '@solar-grid/nest-common';
import { MatchingService, PricingUnavailableError } from './matching.service';
import { MarketQueriesService } from './market-queries.service';
import { MatchListQuery, MatchRunResponse, TradeMatchResponse } from './dto/market.dto';

@ApiTags('Matching')
@Controller()
export class MatchingController {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly queries: MarketQueriesService,
  ) {}

  @Post('matching/run')
  @RequiresOperator()
  @WriteRateLimit()
  // A command, not a resource: nothing is created at a new URL.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run matching now',
    description:
      'Settles trades left unconfirmed by earlier runs, then matches open offers with open requests. Safe to call while events are being consumed.',
  })
  @ApiOkResponse({ type: MatchRunResponse })
  @ApiServiceUnavailableResponse({
    type: ApiErrorResponse,
    description: 'Pricing did not answer. Nothing was reserved, so the run can simply be retried.',
  })
  async runMatching(@CorrelationId() correlationId: string): Promise<MatchRunResponse> {
    try {
      return await this.matchingService.runMatching(correlationId);
    } catch (err) {
      if (err instanceof PricingUnavailableError) {
        throw new DownstreamUnavailableException(
          'Matching could not run because the pricing service did not answer.',
        );
      }
      throw err;
    }
  }

  @Get('matches')
  @ApiOperation({ summary: 'List trade matches, newest first' })
  @ApiPageResponse(TradeMatchResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Query() query: MatchListQuery) {
    return this.queries.listMatches(query);
  }

  @Get('matches/:tradeId')
  @ApiOperation({ summary: 'Get one trade match' })
  @ApiOkResponse({ type: TradeMatchResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  get(@Param() { tradeId }: TradeIdParam): Promise<TradeMatchResponse> {
    return this.queries.getMatch(tradeId);
  }
}
