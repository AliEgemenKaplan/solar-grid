import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { toOfferResponse } from '../matching/matching.service';

@ApiTags('Offers')
@Controller('offers')
export class OffersController {
  private readonly logger = new Logger(OffersController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sell offers' })
  async getOffers() {
    const offers = await this.prisma.sellOffer.findMany({ orderBy: { createdAt: 'desc' } });
    return offers.map(toOfferResponse);
  }
}
