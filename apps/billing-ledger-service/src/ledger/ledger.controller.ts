import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney } from '@solar-grid/shared-utils';

@ApiTags('Ledger')
@Controller('ledger')
export class LedgerController {
  private readonly logger = new Logger(LedgerController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':householdId')
  @ApiOperation({ summary: 'Get immutable ledger entries for a household' })
  @ApiResponse({ status: 200, description: 'List of CREDIT and DEBIT ledger entries' })
  async getLedger(@Param('householdId') householdId: string) {
    this.logger.log(`GET /ledger/${householdId}`);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { householdId },
      orderBy: { createdAt: 'desc' },
    });
    return entries.map((entry) => ({
      id: entry.id,
      tradeId: entry.tradeId,
      householdId: entry.householdId,
      entryType: entry.entryType,
      amount: formatMoney(entry.amount),
      currency: entry.currency,
      correlationId: entry.correlationId,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}
