import { Controller, Get, Param, Headers, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { HouseholdsService } from './households.service';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

@ApiTags('Households')
@ApiHeader({ name: HEADER_CORRELATION_ID, required: false })
@Controller('households')
export class HouseholdsController {
  private readonly logger = new Logger(HouseholdsController.name);

  constructor(private readonly householdsService: HouseholdsService) {}

  @Get(':householdId/status')
  @ApiOperation({ summary: 'Get current energy status for a household' })
  @ApiResponse({ status: 200, description: 'Current energy status (SURPLUS / DEMAND / BALANCED)' })
  @ApiResponse({ status: 404, description: 'Household not found' })
  async getStatus(
    @Param('householdId') householdId: string,
    @Headers(HEADER_CORRELATION_ID) correlationId: string,
  ) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`GET /households/${householdId}/status [cid=${cid}]`);
    return this.householdsService.getStatus(householdId);
  }
}
