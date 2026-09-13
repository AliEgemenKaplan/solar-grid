import { ConfigService } from '@nestjs/config';
import { readRetryConfig, retryDelayMs } from './retry.config';
import {
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  EXCHANGE_SOLAR_GRID_ENERGY_RETRY,
  QUEUE_TRADE_MATCHING_DLQ,
  ROUTING_KEY_DLQ,
  ROUTING_KEY_RETRY_REDELIVERY,
  retryQueueName,
  retryRoutingKey,
} from '@solar-grid/shared-contracts';

/**
 * The RabbitMQ topology, in one place so the service and its tests declare the
 * same thing. Everything here is durable, and it is re-declared on every
 * connect, so a broker that was restarted gets its exchanges and queues back
 * before a message is consumed.
 */
export function buildRabbitMqConfig(config: ConfigService) {
  const { maxRetries, baseDelayMs, prefetch } = readRetryConfig(config);

  // One queue per attempt. A single queue with per-message TTL would be less
  // topology, but RabbitMQ only expires messages at the head of a queue, so
  // one long delay would hold up every shorter one queued behind it.
  const retryQueues = Array.from({ length: maxRetries }, (_, index) => {
    const attempt = index + 1;
    return {
      name: retryQueueName(attempt),
      options: {
        durable: true,
        arguments: {
          'x-message-ttl': retryDelayMs(attempt, baseDelayMs),
          // When the delay expires the message goes back to the main exchange
          // under a key the main queue is also bound to.
          'x-dead-letter-exchange': EXCHANGE_SOLAR_GRID_ENERGY,
          'x-dead-letter-routing-key': ROUTING_KEY_RETRY_REDELIVERY,
        },
      },
      exchange: EXCHANGE_SOLAR_GRID_ENERGY_RETRY,
      routingKey: retryRoutingKey(attempt),
    };
  });

  return {
    exchanges: [
      { name: EXCHANGE_SOLAR_GRID_ENERGY, type: 'topic', options: { durable: true } },
      { name: EXCHANGE_SOLAR_GRID_ENERGY_RETRY, type: 'topic', options: { durable: true } },
      { name: EXCHANGE_SOLAR_GRID_ENERGY_DLX, type: 'topic', options: { durable: true } },
    ],
    queues: [
      {
        name: QUEUE_TRADE_MATCHING_DLQ,
        options: { durable: true },
        exchange: EXCHANGE_SOLAR_GRID_ENERGY_DLX,
        routingKey: ROUTING_KEY_DLQ,
      },
      ...retryQueues,
    ],
    uri: config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
    connectionInitOptions: { wait: false },
    enableDirectReplyTo: false,
    channels: {
      'channel-1': {
        // Matching is serialised by a database lock anyway, so a larger window
        // buys throughput the matching step cannot use.
        prefetchCount: prefetch,
        default: true,
      },
    },
  };
}
