import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AmqpConnection, RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { randomUUID } from 'node:crypto';
import {
  EnergyEventType,
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  QUEUE_TRADE_MATCHING_DLQ,
  QUEUE_TRADE_MATCHING_ENERGY,
  ROUTING_KEY_DLQ,
  ROUTING_KEY_SURPLUS_DETECTED,
} from '@solar-grid/shared-contracts';
import { EnergyEventsConsumer } from '../src/messaging/energy-events.consumer';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(240_000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('failed events reach the dead letter queue', () => {
  let container: StartedRabbitMQContainer;
  let app: INestApplication;
  let amqp: AmqpConnection;

  const sellOfferCreate = jest.fn();
  const runMatching = jest.fn();

  beforeAll(async () => {
    container = await new RabbitMQContainer('rabbitmq:3.12-management-alpine').start();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        RabbitMQModule.forRoot({
          uri: container.getAmqpUrl(),
          connectionInitOptions: { wait: true, timeout: 30_000 },
          enableDirectReplyTo: false,
          exchanges: [
            { name: EXCHANGE_SOLAR_GRID_ENERGY, type: 'topic', options: { durable: true } },
            { name: EXCHANGE_SOLAR_GRID_ENERGY_DLX, type: 'topic', options: { durable: true } },
          ],
          queues: [
            {
              name: QUEUE_TRADE_MATCHING_DLQ,
              options: { durable: true },
              exchange: EXCHANGE_SOLAR_GRID_ENERGY_DLX,
              routingKey: ROUTING_KEY_DLQ,
            },
          ],
          channels: { 'channel-1': { prefetchCount: 1, default: true } },
        }),
      ],
      providers: [
        EnergyEventsConsumer,
        { provide: PrismaService, useValue: { sellOffer: { create: sellOfferCreate } } },
        { provide: MatchingService, useValue: { runMatching } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    amqp = app.get(AmqpConnection);
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    sellOfferCreate.mockReset();
    runMatching.mockReset();
    await amqp.channel.purgeQueue(QUEUE_TRADE_MATCHING_DLQ);
    await amqp.channel.purgeQueue(QUEUE_TRADE_MATCHING_ENERGY);
  });

  async function waitForQueueDepth(queue: string, expected: number, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let observed = -1;
    while (Date.now() < deadline) {
      observed = (await amqp.channel.checkQueue(queue)).messageCount;
      if (observed === expected) return;
      await wait(250);
    }
    throw new Error(`${queue} held ${observed} messages, expected ${expected}`);
  }

  function publishSurplus(overrides: Record<string, unknown> = {}) {
    return amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, {
      eventId: randomUUID(),
      eventType: EnergyEventType.EnergySurplusDetected,
      correlationId: `cid-${randomUUID()}`,
      householdId: 'HH-SELLER',
      productionKwh: 10,
      consumptionKwh: 3,
      surplusKwh: 7,
      timestamp: new Date().toISOString(),
      ...overrides,
    });
  }

  it('parks an event in the DLQ instead of redelivering it forever', async () => {
    sellOfferCreate.mockRejectedValue(new Error('database is not available'));

    await publishSurplus();

    await waitForQueueDepth(QUEUE_TRADE_MATCHING_DLQ, 1);
    await waitForQueueDepth(QUEUE_TRADE_MATCHING_ENERGY, 0);

    // The old default requeued the message, so the handler ran in a hot loop.
    // Give it room to do that again and confirm it does not.
    await wait(2000);
    expect(sellOfferCreate).toHaveBeenCalledTimes(1);
    expect((await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(1);
  });

  it('sends a malformed event straight to the DLQ without touching the database', async () => {
    await publishSurplus({ surplusKwh: 'quite a lot' });

    await waitForQueueDepth(QUEUE_TRADE_MATCHING_DLQ, 1);
    expect(sellOfferCreate).not.toHaveBeenCalled();
    expect(runMatching).not.toHaveBeenCalled();
  });

  it('keeps processing later events after one is dead lettered', async () => {
    sellOfferCreate.mockRejectedValueOnce(new Error('database is not available'));
    sellOfferCreate.mockResolvedValue({ id: 'offer-1' });
    runMatching.mockResolvedValue({ matched: 0, failed: 0, skipped: 0, pending: 0, settled: 0 });

    await publishSurplus();
    await waitForQueueDepth(QUEUE_TRADE_MATCHING_DLQ, 1);

    await publishSurplus();
    await waitForQueueDepth(QUEUE_TRADE_MATCHING_ENERGY, 0);

    // One poison message must not block the queue behind it.
    expect(runMatching).toHaveBeenCalledTimes(1);
    expect((await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(1);
  });
});
