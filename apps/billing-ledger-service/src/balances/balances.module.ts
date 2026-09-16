import { Module } from '@nestjs/common';
import { BalancesController } from './balances.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  controllers: [BalancesController],
})
export class BalancesModule {}
