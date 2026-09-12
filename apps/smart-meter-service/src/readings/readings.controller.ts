import { Controller, Post, Get, Body, Param, Headers, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { ReadingsService } from './readings.service';
import { CreateReadingDto } from './dto/create-reading.dto';
import { getOrGenerateCorrelationId } from '@solar-grid/shared-utils';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

@ApiTags('Readings')
@ApiHeader({ name: HEADER_CORRELATION_ID, required: false, description: 'Correlation ID for tracing' })
@Controller('readings')
export class ReadingsController {
  private readonly logger = new Logger(ReadingsController.name);

  constructor(private readonly readingsService: ReadingsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a smart meter reading' })
  @ApiResponse({ status: 201, description: 'Reading stored and events published if applicable' })
  async create(
    @Body() dto: CreateReadingDto,
    @Headers(HEADER_CORRELATION_ID) correlationId: string,
  ) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`POST /readings householdId=${dto.householdId} [cid=${cid}]`);
    return this.readingsService.createReading(dto, cid);
  }

  @Get(':householdId')
  @ApiOperation({ summary: 'Get readings for a household' })
  @ApiResponse({ status: 200, description: 'List of meter readings' })
  async findByHousehold(
    @Param('householdId') householdId: string,
    @Headers(HEADER_CORRELATION_ID) correlationId: string,
  ) {
    const cid = getOrGenerateCorrelationId({ [HEADER_CORRELATION_ID]: correlationId });
    this.logger.log(`GET /readings/${householdId} [cid=${cid}]`);
    return this.readingsService.getReadingsByHousehold(householdId);
  }
}
