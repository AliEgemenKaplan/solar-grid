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
import { PricesModule } from './prices/prices.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule.forRoot(),
    MetricsModule.forRoot({ service: 'pricing-engine-service' }),
    PrismaModule,
    PricesModule,
    StatsModule,
    HealthModule.forRoot({
      service: 'pricing-engine-service',
      inject: [PrismaService],
      checks: (prisma: PrismaService) => [databaseCheck(() => prisma.$queryRaw`SELECT 1`)],
    }),
  ],
})
export class AppModule {}
