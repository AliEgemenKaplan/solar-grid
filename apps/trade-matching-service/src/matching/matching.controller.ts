import { Controller, Get, Post, Param, Headers, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { MatchingService } from './matching.service';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

@ApiTags('Matching')
@ApiHeader({ name: HEADER_CORRELATION_ID, required: false })
@Controller()
export class MatchingController {
  private readonly logger = new Logger(MatchingController.name);

  constructor(private readonly matchingService: MatchingService) {}

  @Post('matching/run')
  @ApiOperation({ summary: 'Manually trigger the FIFO matching algorithm' })
  @ApiResponse({ status: 201, description: 'Matching result with counts' })
  async runMatching(@Headers(HEADER_CORRELATION_ID) correlationId: string) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`POST /matching/run [cid=${cid}]`);
    return this.matchingService.runMatching(cid);
  }

  @Get('matches')
  @ApiOperation({ summary: 'Get all trade matches' })
  async getMatches() {
    return this.matchingService.getMatches();
  }

  @Get('matches/:tradeId')
  @ApiOperation({ summary: 'Get a specific trade match by trade ID' })
  async getMatch(@Param('tradeId') tradeId: string) {
    return this.matchingService.getMatchByTradeId(tradeId);
  }
}
