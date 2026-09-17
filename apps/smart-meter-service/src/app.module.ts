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
import { MessagingModule } from './messaging/messaging.module';
import { ReadingsModule } from './readings/readings.module';
import { HouseholdsModule } from './households/households.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule.forRoot(),
    MetricsModule.forRoot({ service: 'smart-meter-service' }),
    PrismaModule,
    ReadingsModule,
    HouseholdsModule,
    StatsModule,
    HealthModule.forRoot({
      service: 'smart-meter-service',
      imports: [MessagingModule],
      inject: [PrismaService, AmqpConnection],
      // Readings are stored with their events in the outbox, so a broker
      // outage delays publishing but does not stop this service taking readings.
      checks: (prisma: PrismaService, amqp: AmqpConnection) => [
        databaseCheck(() => prisma.$queryRaw`SELECT 1`),
        rabbitMqCheck(amqp, false),
      ],
    }),
  ],
})
export class AppModule {}
