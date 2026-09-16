import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimitModule } from '@solar-grid/nest-common';
import { PrismaModule } from './prisma/prisma.module';
import { ReadingsModule } from './readings/readings.module';
import { HouseholdsModule } from './households/households.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule.forRoot(),
    PrismaModule,
    ReadingsModule,
    HouseholdsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
