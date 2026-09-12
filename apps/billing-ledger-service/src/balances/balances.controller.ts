import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Balances')
@Controller('balances')
export class BalancesController {
  private readonly logger = new Logger(BalancesController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':householdId')
  @ApiOperation({ summary: 'Get current balance for a household' })
  @ApiResponse({ status: 200, description: 'Current balance (positive = net seller, negative = net buyer)' })
  async getBalance(@Param('householdId') householdId: string) {
    this.logger.log(`GET /balances/${householdId}`);
    const balance = await this.prisma.householdBalance.findUnique({
      where: { householdId },
    });
    if (!balance) {
      return { householdId, balance: 0, currency: 'TRY', updatedAt: null };
    }
    return balance;
  }
}
