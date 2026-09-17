import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  databaseCheck,
  HealthModule,
  MetricsModule,
  rabbitMqCheck,
  RateLimitModule,
} from '@solar-grid/nest-common';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { MatchingModule } from './matching/matching.module';
import { MessagingModule } from './messaging/messaging.module';
import { OffersModule } from './offers/offers.module';
import { RequestsModule } from './requests/requests.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule.forRoot(),
    MetricsModule.forRoot({ service: 'trade-matching-service' }),
    PrismaModule,
    MatchingModule,
    MessagingModule,
    OffersModule,
    RequestsModule,
    StatsModule,
    HealthModule.forRoot({
      service: 'trade-matching-service',
      imports: [MessagingModule],
      inject: [PrismaService, AmqpConnection],
      // Consuming energy events is most of what this service does; without
      // the broker it can answer reads but it is not doing its job.
      checks: (prisma: PrismaService, amqp: AmqpConnection) => [
        databaseCheck(() => prisma.$queryRaw`SELECT 1`),
        rabbitMqCheck(amqp, true),
      ],
    }),
  ],
})
export class AppModule {}
