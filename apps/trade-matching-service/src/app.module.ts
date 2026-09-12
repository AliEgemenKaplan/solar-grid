import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MatchingModule } from './matching/matching.module';
import { MessagingModule } from './messaging/messaging.module';
import { OffersModule } from './offers/offers.module';
import { RequestsModule } from './requests/requests.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MatchingModule,
    MessagingModule,
    OffersModule,
    RequestsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
