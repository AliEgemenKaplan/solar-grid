import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TradesModule } from './trades/trades.module';
import { BalancesModule } from './balances/balances.module';
import { LedgerModule } from './ledger/ledger.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TradesModule,
    BalancesModule,
    LedgerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
