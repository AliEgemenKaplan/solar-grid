import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponse,
  ApiPageResponse,
  CorrelationId,
  HouseholdIdParam,
  PaginationQuery,
  WriteRateLimit,
} from '@solar-grid/nest-common';
import { ReadingsService } from './readings.service';
import { CreateReadingDto, ReadingResponse, ReadingSummary } from './dto/create-reading.dto';

@ApiTags('Readings')
@Controller('readings')
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  /**
   * The public edge of the system: meters report here. It is not behind a
   * token - there is no meter identity in this project - so it is rate
   * limited instead, and every value is validated before anything is stored.
   */
  @Post()
  @WriteRateLimit()
  @ApiOperation({
    summary: 'Submit a meter reading',
    description:
      'Stores the reading and queues a surplus or demand event in the same transaction. Re-sending the same household and timestamp returns the stored reading with 200.',
  })
  @ApiCreatedResponse({ type: ReadingResponse, description: 'Stored for the first time' })
  @ApiOkResponse({
    type: ReadingResponse,
    description: 'Already stored; duplicate: true, no new event',
  })
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorResponse,
    description: 'A reading from the future',
  })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse })
  async create(
    @Body() dto: CreateReadingDto,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadingResponse> {
    const reading = await this.readingsService.createReading(dto, correlationId);
    response.status(reading.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return reading;
  }

  @Get(':householdId')
  @ApiOperation({ summary: 'Readings for a household, newest first' })
  @ApiPageResponse(ReadingSummary)
  @ApiBadRequestResponse({ type: ApiErrorResponse })
  list(@Param() { householdId }: HouseholdIdParam, @Query() query: PaginationQuery) {
    return this.readingsService.getReadingsByHousehold(householdId, query);
  }
}
