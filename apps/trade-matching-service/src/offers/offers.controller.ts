import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse, ApiPageResponse } from '@solar-grid/nest-common';
import { MarketQueriesService } from '../matching/market-queries.service';
import { OfferListQuery, OfferResponse } from '../matching/dto/market.dto';

@ApiTags('Offers')
@Controller('offers')
export class OffersController {
  constructor(private readonly queries: MarketQueriesService) {}

  @Get()
  @ApiOperation({ summary: 'List sell offers, newest first' })
  @ApiPageResponse(OfferResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Query() query: OfferListQuery) {
    return this.queries.listOffers(query);
  }
}
