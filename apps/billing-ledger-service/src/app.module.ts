import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  databaseCheck,
  HealthModule,
  MetricsModule,
  RateLimitModule,
} from '@solar-grid/nest-common';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { TradesModule } from './trades/trades.module';
import { BalancesModule } from './balances/balances.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule.forRoot(),
    MetricsModule.forRoot({ service: 'billing-ledger-service' }),
    PrismaModule,
    TradesModule,
    BalancesModule,
    LedgerModule,
    HealthModule.forRoot({
      service: 'billing-ledger-service',
      inject: [PrismaService],
      checks: (prisma: PrismaService) => [databaseCheck(() => prisma.$queryRaw`SELECT 1`)],
    }),
  ],
})
export class AppModule {}
