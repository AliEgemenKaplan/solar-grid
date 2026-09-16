import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse, ApiPageResponse } from '@solar-grid/nest-common';
import { MarketQueriesService } from '../matching/market-queries.service';
import { OfferListQuery, RequestResponse } from '../matching/dto/market.dto';

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly queries: MarketQueriesService) {}

  @Get()
  @ApiOperation({ summary: 'List buy requests, newest first' })
  @ApiPageResponse(RequestResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Query() query: OfferListQuery) {
    return this.queries.listRequests(query);
  }
}
