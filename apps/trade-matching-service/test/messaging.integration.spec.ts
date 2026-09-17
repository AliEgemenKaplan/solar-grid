import { execSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AmqpConnection, RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import {
  ENERGY_EVENT_VERSION,
  EnergyEventType,
  EXCHANGE_SOLAR_GRID_ENERGY,
  HEADER_FAILURE_REASON,
  HEADER_RETRY_COUNT,
  QUEUE_TRADE_MATCHING_DLQ,
  QUEUE_TRADE_MATCHING_ENERGY,
  ROUTING_KEY_SURPLUS_DETECTED,
  retryQueueName,
} from '@solar-grid/shared-contracts';
import { configureHttpApp, RateLimitModule } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { MatchingService } from '../src/matching/matching.service';
import { EnergyEventsConsumer } from '../src/messaging/energy-events.consumer';
import { buildRabbitMqConfig } from '../src/messaging/topology';

jest.setTimeout(300_000);

/** Short delays so the retry ladder finishes inside a test. */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeConfig(uri: string): ConfigService {
  return {
    get: (key: string, fallback: string) => {
      if (key === 'RABBITMQ_URL') return uri;
      if (key === 'RABBITMQ_MAX_RETRIES') return String(MAX_RETRIES);
      if (key === 'RABBITMQ_RETRY_DELAY_MS') return String(RETRY_DELAY_MS);
      return fallback;
    },
  } as unknown as ConfigService;
}

function surplusEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    eventType: EnergyEventType.EnergySurplusDetected,
    version: ENERGY_EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    correlationId: `cid-${randomUUID()}`,
    sourceEventId: `reading-${randomUUID()}`,
    householdId: 'HH-SELLER',
    productionKwh: '10.000',
    consumptionKwh: '3.000',
    surplusKwh: '7.000',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('messaging reliability', () => {
  let rabbit: StartedRabbitMQContainer;
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let amqpUri: string;

  beforeAll(async () => {
    [rabbit, postgres] = await Promise.all([
      new RabbitMQContainer('rabbitmq:3.12-management-alpine').start(),
      new PostgreSqlContainer('postgres:15-alpine').start(),
    ]);
    amqpUri = rabbit.getAmqpUrl();

    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: postgres.getConnectionUri() },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasourceUrl: postgres.getConnectionUri() });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await Promise.all([rabbit?.stop(), postgres?.stop()]);
  });

  /**
   * Boots the real consumer against the real topology, with whichever
   * persistence and matching behaviour the test needs.
   *
   * The app gets the same global guard, filter and pipes main.ts installs.
   * Nest applies global enhancers to RabbitMQ handlers too, so a consumer
   * tested without them can pass while the deployed one rejects every event.
   */
  async function startConsumer(overrides: {
    prisma: unknown;
    matching: unknown;
    uri?: string;
  }): Promise<INestApplication> {
    const config = fakeConfig(overrides.uri ?? amqpUri);
    const moduleRef = await Test.createTestingModule({
      imports: [
        RateLimitModule.forRoot(),
        RabbitMQModule.forRoot({
          ...buildRabbitMqConfig(config),
          connectionInitOptions: { wait: true, timeout: 30_000 },
        }),
      ],
      providers: [
        EnergyEventsConsumer,
        { provide: PrismaService, useValue: overrides.prisma },
        { provide: MatchingService, useValue: overrides.matching },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    configureHttpApp(app, {
      title: 'trade-matching-service',
      description: 'messaging test',
      tags: [],
      credentials: [],
    });
    await app.init();
    return app;
  }

  async function purgeAll(amqp: AmqpConnection) {
    await amqp.channel.purgeQueue(QUEUE_TRADE_MATCHING_ENERGY);
    await amqp.channel.purgeQueue(QUEUE_TRADE_MATCHING_DLQ);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await amqp.channel.purgeQueue(retryQueueName(attempt));
    }
  }

  async function waitForQueueDepth(
    amqp: AmqpConnection,
    queue: string,
    expected: number,
    timeoutMs = 30_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let observed = -1;
    while (Date.now() < deadline) {
      observed = (await amqp.channel.checkQueue(queue)).messageCount;
      if (observed === expected) return;
      await wait(200);
    }
    throw new Error(`${queue} held ${observed} messages, expected ${expected}`);
  }

  async function waitFor(
    condition: () => boolean | Promise<boolean>,
    what: string,
    timeoutMs = 30_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await wait(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  describe('retry and dead lettering', () => {
    let app: INestApplication;
    let amqp: AmqpConnection;
    let create: jest.Mock;
    let runMatching: jest.Mock;

    beforeEach(async () => {
      create = jest.fn();
      runMatching = jest.fn().mockResolvedValue({ matched: 0, failed: 0, skipped: 0 });
      app = await startConsumer({
        prisma: { sellOffer: { create }, buyRequest: { create } },
        matching: { runMatching },
      });
      amqp = app.get(AmqpConnection);
      await purgeAll(amqp);
    });

    afterEach(async () => {
      await app?.close();
    });

    it('retries a transient failure and succeeds on a later attempt', async () => {
      create.mockRejectedValueOnce(new Error('database is not available'));
      create.mockResolvedValue({ id: 'offer-1' });

      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, surplusEvent());

      await waitFor(() => runMatching.mock.calls.length === 1, 'the retry to succeed');
      expect(create).toHaveBeenCalledTimes(2);
      expect((await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(0);
    });

    it('stops after the configured number of retries and parks the message', async () => {
      create.mockRejectedValue(new Error('database is still not available'));

      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, surplusEvent());

      await waitForQueueDepth(amqp, QUEUE_TRADE_MATCHING_DLQ, 1);

      // One first attempt plus the configured retries, and then it stops:
      // this is what used to be an endless redelivery loop.
      expect(create).toHaveBeenCalledTimes(MAX_RETRIES + 1);

      const parked = await amqp.channel.get(QUEUE_TRADE_MATCHING_DLQ, { noAck: true });
      if (parked === false) throw new Error('no message in the dead letter queue');
      expect(parked.properties.headers?.[HEADER_RETRY_COUNT]).toBe(MAX_RETRIES);
      expect(String(parked.properties.headers?.[HEADER_FAILURE_REASON])).toContain(
        'database is still not available',
      );
      expect(parked.properties.deliveryMode).toBe(2);

      // And it stays stopped.
      await wait(2 * RETRY_DELAY_MS * 2 ** MAX_RETRIES);
      expect(create).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    });

    it('sends a malformed event straight to the dead letter queue', async () => {
      await amqp.publish(
        EXCHANGE_SOLAR_GRID_ENERGY,
        ROUTING_KEY_SURPLUS_DETECTED,
        surplusEvent({ surplusKwh: 'quite a lot' }),
      );

      await waitForQueueDepth(amqp, QUEUE_TRADE_MATCHING_DLQ, 1);
      // No retries were spent on a message that can never succeed.
      expect(create).not.toHaveBeenCalled();
      expect(runMatching).not.toHaveBeenCalled();
    });

    it('keeps delivering other events while one is working through its retries', async () => {
      const poison = surplusEvent({ householdId: 'HH-POISON' });
      create.mockImplementation(async (args: { data: { householdId: string } }) => {
        if (args.data.householdId === 'HH-POISON') throw new Error('poison');
        return { id: 'offer-ok' };
      });

      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, poison);
      await amqp.publish(
        EXCHANGE_SOLAR_GRID_ENERGY,
        ROUTING_KEY_SURPLUS_DETECTED,
        surplusEvent({ householdId: 'HH-HEALTHY' }),
      );

      await waitFor(() => runMatching.mock.calls.length === 1, 'the healthy event to be processed');
      await waitForQueueDepth(amqp, QUEUE_TRADE_MATCHING_DLQ, 1);
    });
  });

  describe('duplicate delivery', () => {
    let app: INestApplication;
    let amqp: AmqpConnection;
    let runMatching: jest.Mock;

    beforeEach(async () => {
      await prisma.tradeMatch.deleteMany();
      await prisma.sellOffer.deleteMany();
      await prisma.buyRequest.deleteMany();
      runMatching = jest.fn().mockResolvedValue({ matched: 0, failed: 0, skipped: 0 });
      app = await startConsumer({ prisma, matching: { runMatching } });
      amqp = app.get(AmqpConnection);
      await purgeAll(amqp);
    });

    afterEach(async () => {
      await app?.close();
    });

    it('creates one offer when the same event is delivered twice', async () => {
      const event = surplusEvent();

      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, event);
      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, event);

      await waitFor(
        async () => (await prisma.sellOffer.count()) === 1,
        'the first delivery to be stored',
      );
      await wait(1000);

      expect(await prisma.sellOffer.count()).toBe(1);
      // The second delivery was recognised, so no matching run was triggered
      // for it and nothing was parked.
      expect(runMatching).toHaveBeenCalledTimes(1);
      expect((await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(0);
    });

    it('does not duplicate the offer when the consumer fails after writing it', async () => {
      // The offer is written, then the handler blows up before acknowledging -
      // the shape of a consumer crash. The redelivery must not write it again.
      runMatching.mockRejectedValueOnce(new Error('crashed after writing the offer'));

      await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, ROUTING_KEY_SURPLUS_DETECTED, surplusEvent());

      await waitFor(() => runMatching.mock.calls.length >= 1, 'the first attempt');
      await wait(RETRY_DELAY_MS * 4);

      expect(await prisma.sellOffer.count()).toBe(1);
      // The retry found the offer already there and did not write it again,
      // but it did run matching again: that is the step that failed, and a
      // retry that skipped it would leave the offer unmatched.
      expect(runMatching).toHaveBeenCalledTimes(2);
      expect((await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('finishes the message in progress before closing and leaves queued messages for the next consumer', async () => {
      const order: string[] = [];
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => (markStarted = resolve));

      const create = jest.fn(async (args: { data: { householdId: string } }) => {
        if (args.data.householdId === 'HH-IN-FLIGHT') {
          markStarted();
          await released;
        }
        return { id: `offer-${args.data.householdId}` };
      });
      const runMatching = jest.fn(async () => {
        order.push('message handled');
        return { matched: 0, failed: 0, skipped: 0 };
      });
      const prismaDouble = {
        sellOffer: { create },
        buyRequest: { create },
        // Stands in for PrismaService closing its pool.
        onApplicationShutdown: () => {
          order.push('database closed');
        },
      };

      // Only one RabbitMQ module can be running at a time in a process, so
      // the consumer's own connection - open until its shutdown completes - is
      // used to publish and inspect while it closes.
      let consumer: INestApplication | undefined;
      let closing: Promise<unknown> | undefined;
      let next: INestApplication | undefined;
      try {
        consumer = await startConsumer({ prisma: prismaDouble, matching: { runMatching } });
        const amqp = consumer.get(AmqpConnection);
        await purgeAll(amqp);

        await amqp.publish(
          EXCHANGE_SOLAR_GRID_ENERGY,
          ROUTING_KEY_SURPLUS_DETECTED,
          surplusEvent({ householdId: 'HH-IN-FLIGHT' }),
        );
        await started;

        closing = consumer.close().then(() => order.push('application closed'));

        await waitFor(
          async () =>
            (await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_ENERGY)).consumerCount === 0,
          'the consumer to be cancelled',
        );

        // Arrives after the consumer was cancelled: it must wait in the queue.
        await amqp.publish(
          EXCHANGE_SOLAR_GRID_ENERGY,
          ROUTING_KEY_SURPLUS_DETECTED,
          surplusEvent({ householdId: 'HH-QUEUED' }),
        );
        await waitForQueueDepth(amqp, QUEUE_TRADE_MATCHING_ENERGY, 1);
        await wait(500);
        expect(create).toHaveBeenCalledTimes(1);
        // Nothing has closed while the first message is still being handled.
        expect(order).toEqual([]);

        release();
        await closing;

        expect(order).toEqual(['message handled', 'database closed', 'application closed']);

        // The next consumer finds exactly the message that arrived during
        // shutdown: the handled one was acknowledged, not redelivered.
        next = await startConsumer({
          prisma: { sellOffer: { create }, buyRequest: { create } },
          matching: { runMatching },
        });
        const nextAmqp = next.get(AmqpConnection);
        await waitFor(() => create.mock.calls.length === 2, 'the next consumer to take it');
        await wait(1000);
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1][0].data.householdId).toBe('HH-QUEUED');
        await waitForQueueDepth(nextAmqp, QUEUE_TRADE_MATCHING_ENERGY, 0);
        expect((await nextAmqp.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ)).messageCount).toBe(0);
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          expect((await nextAmqp.channel.checkQueue(retryQueueName(attempt))).messageCount).toBe(0);
        }
      } finally {
        // Whatever failed, close what was opened: a connection left open keeps
        // reconnecting and jest never exits.
        release();
        if (closing) await closing.catch(() => undefined);
        else await consumer?.close();
        await next?.close();
      }
    });
  });

  describe('durability', () => {
    it('keeps the topology and its messages across a broker restart', async () => {
      const app = await startConsumer({
        prisma: { sellOffer: { create: jest.fn() }, buyRequest: { create: jest.fn() } },
        matching: { runMatching: jest.fn() },
      });
      const amqp = app.get(AmqpConnection);
      await purgeAll(amqp);

      // Park a persistent message somewhere nothing is consuming from.
      await amqp.publish(
        'solar-grid.energy.dlx',
        'dlq.energy',
        { marker: 'survives-a-restart' },
        { persistent: true, contentType: 'application/json' },
      );
      await waitForQueueDepth(amqp, QUEUE_TRADE_MATCHING_DLQ, 1);
      await app.close();

      await rabbit.restart();

      const afterRestart = await startConsumer({
        prisma: { sellOffer: { create: jest.fn() }, buyRequest: { create: jest.fn() } },
        matching: { runMatching: jest.fn() },
        uri: rabbit.getAmqpUrl(),
      });
      const amqpAfter = afterRestart.get(AmqpConnection);

      try {
        // The durable queues are all still there...
        const main = await amqpAfter.channel.checkQueue(QUEUE_TRADE_MATCHING_ENERGY);
        expect(main.consumerCount).toBeGreaterThan(0);
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          await expect(amqpAfter.channel.checkQueue(retryQueueName(attempt))).resolves.toBeTruthy();
        }

        // ...and the persistent message survived with them.
        const dlq = await amqpAfter.channel.checkQueue(QUEUE_TRADE_MATCHING_DLQ);
        expect(dlq.messageCount).toBe(1);

        const message = await amqpAfter.channel.get(QUEUE_TRADE_MATCHING_DLQ, { noAck: true });
        if (message === false) throw new Error('the message did not survive the restart');
        expect(JSON.parse(message.content.toString())).toEqual({ marker: 'survives-a-restart' });
      } finally {
        await afterRestart.close();
      }
    });
  });
});
