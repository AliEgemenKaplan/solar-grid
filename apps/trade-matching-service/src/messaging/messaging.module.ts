import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnergyEventsConsumer } from './energy-events.consumer';
import { MatchingModule } from '../matching/matching.module';
import {
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  QUEUE_TRADE_MATCHING_DLQ,
  ROUTING_KEY_DLQ,
} from '@solar-grid/shared-contracts';

@Module({
  imports: [
    RabbitMQModule.forRootAsync(RabbitMQModule, {
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        exchanges: [
          {
            name: EXCHANGE_SOLAR_GRID_ENERGY,
            type: 'topic',
            options: { durable: true },
          },
          {
            name: EXCHANGE_SOLAR_GRID_ENERGY_DLX,
            type: 'topic',
            options: { durable: true },
          },
        ],
        queues: [
          {
            name: QUEUE_TRADE_MATCHING_DLQ,
            options: { durable: true },
            exchange: EXCHANGE_SOLAR_GRID_ENERGY_DLX,
            routingKey: ROUTING_KEY_DLQ,
          },
        ],
        uri: config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
        connectionInitOptions: { wait: false },
        enableDirectReplyTo: false,
        channels: {
          'channel-1': {
            prefetchCount: 1,
            default: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
    MatchingModule,
  ],
  providers: [EnergyEventsConsumer],
})
export class MessagingModule {}
