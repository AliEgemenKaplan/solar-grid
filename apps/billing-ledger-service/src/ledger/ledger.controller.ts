import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.prisma.ledgerEntry.findMany({
      where: { householdId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
