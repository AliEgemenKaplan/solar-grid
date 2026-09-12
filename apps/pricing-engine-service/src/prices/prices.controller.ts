import { Controller, Get, Post, Body, Headers, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { PricesService } from './prices.service';
import { RecalculatePriceDto } from './dto/recalculate-price.dto';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

@ApiTags('Prices')
@ApiHeader({ name: HEADER_CORRELATION_ID, required: false })
@Controller('prices')
export class PricesController {
  private readonly logger = new Logger(PricesController.name);

  constructor(private readonly pricesService: PricesService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get the current energy price per kWh' })
  @ApiResponse({ status: 200, description: 'Current price based on latest snapshot' })
  async getCurrent(@Headers(HEADER_CORRELATION_ID) correlationId: string) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`GET /prices/current [cid=${cid}]`);
    return this.pricesService.getCurrentPrice();
  }

  @Post('recalculate')
  @ApiOperation({ summary: 'Recalculate price based on current supply and demand' })
  @ApiResponse({ status: 201, description: 'New price snapshot created' })
  async recalculate(
    @Body() dto: RecalculatePriceDto,
    @Headers(HEADER_CORRELATION_ID) correlationId: string,
  ) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`POST /prices/recalculate supply=${dto.totalSupplyKwh} demand=${dto.totalDemandKwh} [cid=${cid}]`);
    return this.pricesService.recalculate(dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get price snapshot history' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max records (default 50)' })
  async getHistory(
    @Query('limit') limit?: number,
    @Headers(HEADER_CORRELATION_ID) correlationId?: string,
  ) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`GET /prices/history [cid=${cid}]`);
    return this.pricesService.getPriceHistory(limit ? Number(limit) : 50);
  }
}
