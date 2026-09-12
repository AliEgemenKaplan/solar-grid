import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Offers')
@Controller('offers')
export class OffersController {
  private readonly logger = new Logger(OffersController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sell offers' })
  async getOffers() {
    return this.prisma.sellOffer.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
