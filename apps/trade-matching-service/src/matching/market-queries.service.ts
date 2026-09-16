import { Injectable } from '@nestjs/common';
import { Page, pageWindow, ResourceNotFoundException, toPage } from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { toOfferResponse, toRequestResponse, toTradeResponse } from './matching.service';
import {
  MatchListQuery,
  OfferListQuery,
  OfferResponse,
  RequestResponse,
  TradeMatchResponse,
} from './dto/market.dto';

/**
 * Read side of the market: what is on offer, what is wanted, what traded.
 * Every list is paged, filtered on indexed columns, and ordered with the id
 * as a tie breaker so a page never repeats or skips a row.
 */
@Injectable()
export class MarketQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listMatches(query: MatchListQuery): Promise<Page<TradeMatchResponse>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tradeMatch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.tradeMatch.count({ where }),
    ]);
    return toPage(rows.map(toTradeResponse), total, query);
  }

  async getMatch(tradeId: string): Promise<TradeMatchResponse> {
    const match = await this.prisma.tradeMatch.findUnique({ where: { tradeId } });
    if (!match) throw new ResourceNotFoundException(`Trade ${tradeId} does not exist.`);
    return toTradeResponse(match);
  }

  async listOffers(query: OfferListQuery): Promise<Page<OfferResponse>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sellOffer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.sellOffer.count({ where }),
    ]);
    return toPage(rows.map(toOfferResponse), total, query);
  }

  async listRequests(query: OfferListQuery): Promise<Page<RequestResponse>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.buyRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.prisma.buyRequest.count({ where }),
    ]);
    return toPage(rows.map(toRequestResponse), total, query);
  }
}
