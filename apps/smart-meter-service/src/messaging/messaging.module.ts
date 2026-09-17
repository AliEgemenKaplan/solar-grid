import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OutboxPublisherService } from './outbox-publisher.service';
import { SmartMeterMetrics } from '../metrics/smart-meter.metrics';
import { EXCHANGE_SOLAR_GRID_ENERGY } from '@solar-grid/shared-contracts';

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        exchanges: [
          {
            name: EXCHANGE_SOLAR_GRID_ENERGY,
            type: 'topic',
            options: { durable: true },
          },
        ],
        uri: config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
        connectionInitOptions: { wait: false },
        enableDirectReplyTo: false,
        // A durable exchange only keeps the topology across a broker restart.
        // Messages also have to be marked persistent or they are dropped with
        // the rest of the in-memory state.
        defaultPublishOptions: {
          persistent: true,
          contentType: 'application/json',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [OutboxPublisherService, SmartMeterMetrics],
  exports: [OutboxPublisherService, SmartMeterMetrics, RabbitMQModule],
})
export class MessagingModule {}
