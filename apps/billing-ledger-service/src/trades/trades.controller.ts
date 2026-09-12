import { Controller, Post, Get, Body, Param, Headers, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

@ApiTags('Trades')
@ApiHeader({ name: HEADER_CORRELATION_ID, required: false })
@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);

  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @ApiOperation({ summary: 'Record a completed energy trade (idempotent)' })
  @ApiResponse({ status: 201, description: 'Trade recorded, ledger entries created' })
  async create(@Body() dto: CreateTradeDto, @Headers(HEADER_CORRELATION_ID) correlationId: string) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`POST /trades tradeId=${dto.tradeId} [cid=${cid}]`);
    return this.tradesService.createTrade(dto);
  }

  @Get(':tradeId')
  @ApiOperation({ summary: 'Get trade record by trade ID' })
  async findOne(@Param('tradeId') tradeId: string) {
    return this.tradesService.getTradeById(tradeId);
  }

  @Get('household/:householdId')
  @ApiOperation({ summary: 'Get all trades for a household (as buyer or seller)' })
  async findByHousehold(@Param('householdId') householdId: string) {
    return this.tradesService.getTradesByHousehold(householdId);
  }
}
