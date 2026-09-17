import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnergyEventsConsumer } from './energy-events.consumer';
import { MatchingModule } from '../matching/matching.module';
import { buildRabbitMqConfig } from './topology';

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => buildRabbitMqConfig(config),
      inject: [ConfigService],
    }),
    MatchingModule,
  ],
  providers: [EnergyEventsConsumer],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
