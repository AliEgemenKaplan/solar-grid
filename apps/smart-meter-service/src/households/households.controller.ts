import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse, ApiPageResponse, HouseholdIdParam } from '@solar-grid/nest-common';
import { HouseholdsService } from './households.service';
import { HouseholdListQuery, HouseholdStatusResponse } from '../readings/dto/create-reading.dto';

@ApiTags('Households')
@Controller('households')
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) {}

  @Get()
  @ApiOperation({ summary: 'Households that have reported, most recently active first' })
  @ApiPageResponse(HouseholdStatusResponse)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Query() query: HouseholdListQuery) {
    return this.householdsService.listHouseholds(query);
  }

  @Get(':householdId/status')
  @ApiOperation({ summary: 'Current energy status for a household' })
  @ApiOkResponse({ type: HouseholdStatusResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'The household has never reported' })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  getStatus(@Param() { householdId }: HouseholdIdParam): Promise<HouseholdStatusResponse> {
    return this.householdsService.getStatus(householdId);
  }
}
