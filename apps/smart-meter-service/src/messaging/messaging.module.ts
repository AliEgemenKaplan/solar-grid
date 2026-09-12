import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessagingService } from './messaging.service';
import { EXCHANGE_SOLAR_GRID_ENERGY } from '@solar-grid/shared-contracts';

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
        ],
        uri: config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
        connectionInitOptions: { wait: false },
        enableDirectReplyTo: false,
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
