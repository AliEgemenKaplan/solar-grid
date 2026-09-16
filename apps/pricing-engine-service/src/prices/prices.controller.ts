import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiPageResponse,
  PaginationQuery,
  RequiresOperator,
  WriteRateLimit,
} from '@solar-grid/nest-common';
import { PricesService } from './prices.service';
import { RecalculatePriceDto } from './dto/recalculate-price.dto';
import { PriceResponse, PriceSnapshotResponse } from './dto/price.responses';

@ApiTags('Prices')
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get('current')
  @ApiOperation({ summary: 'The price per kWh trades are settled at right now' })
  @ApiOkResponse({ type: PriceResponse })
  getCurrent(): Promise<PriceResponse> {
    return this.pricesService.getCurrentPrice();
  }

  /**
   * Changes what every subsequent trade costs, so it is an operator action,
   * not something a visitor to the dashboard can trigger.
   */
  @Post('recalculate')
  @RequiresOperator()
  @WriteRateLimit()
  @ApiOperation({ summary: 'Recalculate the price from neighbourhood supply and demand' })
  @ApiCreatedResponse({ type: PriceResponse, description: 'A new price snapshot was recorded' })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  recalculate(@Body() dto: RecalculatePriceDto): Promise<PriceResponse> {
    return this.pricesService.recalculate(dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Price snapshots, newest first' })
  @ApiPageResponse(PriceSnapshotResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  history(@Query() query: PaginationQuery) {
    return this.pricesService.getPriceHistory(query);
  }
}
