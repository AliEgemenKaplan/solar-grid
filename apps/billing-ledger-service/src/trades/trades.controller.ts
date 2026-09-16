import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponse,
  ApiPageResponse,
  HouseholdIdParam,
  PaginationQuery,
  RequiresInternalService,
  TradeIdParam,
} from '@solar-grid/nest-common';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { CompletedTradeResponse, TradeListQuery } from './dto/trade.responses';

@ApiTags('Trades')
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @RequiresInternalService()
  @ApiOperation({
    summary: 'Record a completed trade',
    description:
      'Called by trade-matching-service. Idempotent on idempotencyKey: the same key with the same payload returns the stored trade with 200; the same key with a different payload is a 409.',
  })
  @ApiCreatedResponse({ type: CompletedTradeResponse, description: 'Recorded for the first time' })
  @ApiOkResponse({
    type: CompletedTradeResponse,
    description: 'Already recorded with this key and payload; the stored trade, duplicate: true',
  })
  @ApiBadRequestResponse({ type: ApiErrorResponse, description: 'The request failed validation' })
  @ApiConflictResponse({
    type: ApiErrorResponse,
    description: 'IDEMPOTENCY_CONFLICT for a reused key, CONFLICT for a reused trade id',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'A household on both sides, or a total that is not energy times price',
  })
  async create(
    @Body() dto: CreateTradeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CompletedTradeResponse> {
    const { trade, created } = await this.tradesService.createTrade(dto);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return trade;
  }

  @Get()
  @ApiOperation({ summary: 'List trades, newest first, optionally for one household or operation' })
  @ApiPageResponse(CompletedTradeResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Query() query: TradeListQuery) {
    return this.tradesService.listTrades(query);
  }

  @Get('household/:householdId')
  @ApiOperation({ summary: 'List trades where the household is the seller or the buyer' })
  @ApiPageResponse(CompletedTradeResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  listForHousehold(@Param() { householdId }: HouseholdIdParam, @Query() query: PaginationQuery) {
    return this.tradesService.listTrades({ page: query.page, limit: query.limit, householdId });
  }

  @Get(':tradeId')
  @ApiOperation({ summary: 'Get one trade' })
  @ApiOkResponse({ type: CompletedTradeResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  findOne(@Param() { tradeId }: TradeIdParam): Promise<CompletedTradeResponse> {
    return this.tradesService.getTradeById(tradeId);
  }
}
