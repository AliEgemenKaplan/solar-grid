import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { toRequestResponse } from '../matching/matching.service';

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  private readonly logger = new Logger(RequestsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get all buy requests' })
  async getRequests() {
    const requests = await this.prisma.buyRequest.findMany({ orderBy: { createdAt: 'desc' } });
    return requests.map(toRequestResponse);
  }
}
