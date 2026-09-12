import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  private readonly logger = new Logger(RequestsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get all buy requests' })
  async getRequests() {
    return this.prisma.buyRequest.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
