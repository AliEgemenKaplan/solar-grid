import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney } from '@solar-grid/shared-utils';

@ApiTags('Balances')
@Controller('balances')
export class BalancesController {
  private readonly logger = new Logger(BalancesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':householdId')
  @ApiOperation({ summary: 'Get current balance for a household' })
  @ApiResponse({
    status: 200,
    description: 'Current balance (positive = net seller, negative = net buyer)',
  })
  async getBalance(@Param('householdId') householdId: string) {
    this.logger.log(`GET /balances/${householdId}`);
    const balance = await this.prisma.householdBalance.findUnique({
      where: { householdId },
    });
    if (!balance) {
      // A household with no trades has a zero balance rather than no balance.
      return { householdId, balance: formatMoney(0), currency: 'TRY', updatedAt: null };
    }
    return {
      id: balance.id,
      householdId: balance.householdId,
      balance: formatMoney(balance.balance),
      currency: balance.currency,
      updatedAt: balance.updatedAt.toISOString(),
    };
  }
}
