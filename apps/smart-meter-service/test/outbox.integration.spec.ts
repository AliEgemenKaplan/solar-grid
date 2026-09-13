import { execSync } from 'node:child_process';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection, RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import {
  EXCHANGE_SOLAR_GRID_ENERGY,
  HEADER_CORRELATION_ID,
  ROUTING_KEY_SURPLUS_DETECTED,
} from '@solar-grid/shared-contracts';
import { PrismaClient } from '../generated/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboxPublisherService } from '../src/messaging/outbox-publisher.service';
import { ReadingsService } from '../src/readings/readings.service';

jest.setTimeout(240_000);

const TEST_QUEUE = 'test.outbox.queue';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keeps the background poll timer out of the way; tests drain explicitly. */
const config = (publishTimeoutMs: number) => ({
  get: (key: string, fallback: string) => {
    if (key === 'OUTBOX_PUBLISH_TIMEOUT_MS') return String(publishTimeoutMs);
    if (key === 'OUTBOX_POLL_INTERVAL_MS') return String(60 * 60 * 1000);
    return fallback;
  },
});

describe('smart meter outbox', () => {
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:15-alpine').start();
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
    await postgres?.stop();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.meterReading.deleteMany();
    await prisma.householdEnergyStatus.deleteMany();
  });

  describe('writing a reading', () => {
    const neverPublishes = { drain: async () => 0 } as unknown as OutboxPublisherService;
    const readings = () => new ReadingsService(prisma as unknown as PrismaService, neverPublishes);

    it('stores the reading and its event in one transaction', async () => {
      await readings().createReading(
        {
          householdId: 'HH-SELLER',
          productionKwh: 10,
          consumptionKwh: 3,
          timestamp: '2026-05-27T10:00:00.000Z',
        },
        'cid-outbox-1',
      );

      const reading = await prisma.meterReading.findFirstOrThrow();
      expect(reading.status).toBe('SURPLUS');

      const event = await prisma.outboxEvent.findFirstOrThrow();
      expect(event.status).toBe('PENDING');
      expect(event.routingKey).toBe(ROUTING_KEY_SURPLUS_DETECTED);
      expect(event.correlationId).toBe('cid-outbox-1');
      expect(event.payload).toMatchObject({
        eventType: 'EnergySurplusDetected',
        householdId: 'HH-SELLER',
        // Energy travels as a fixed-scale decimal string, not a JSON number.
        surplusKwh: '7.000',
      });
    });

    it('ignores a retried reading instead of queueing a second event', async () => {
      const dto = {
        householdId: 'HH-SELLER',
        productionKwh: 10,
        consumptionKwh: 3,
        timestamp: '2026-05-27T10:00:00.000Z',
      };

      const first = await readings().createReading(dto, 'cid-a');
      const second = await readings().createReading(dto, 'cid-b');

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(await prisma.meterReading.count()).toBe(1);
      expect(await prisma.outboxEvent.count()).toBe(1);
    });

    it('queues nothing for a balanced reading', async () => {
      await readings().createReading(
        {
          householdId: 'HH-EVEN',
          productionKwh: 5,
          consumptionKwh: 5,
          timestamp: '2026-05-27T11:00:00.000Z',
        },
        'cid-balanced',
      );

      expect(await prisma.meterReading.count()).toBe(1);
      expect(await prisma.outboxEvent.count()).toBe(0);
    });
  });

  describe('publishing', () => {
    async function seedPendingEvent() {
      const readings = new ReadingsService(
        prisma as unknown as PrismaService,
        {
          drain: async () => 0,
        } as unknown as OutboxPublisherService,
      );
      await readings.createReading(
        {
          householdId: 'HH-SELLER',
          productionKwh: 10,
          consumptionKwh: 3,
          timestamp: '2026-05-27T10:00:00.000Z',
        },
        'cid-publish',
      );
      return prisma.outboxEvent.findFirstOrThrow();
    }

    async function buildPublisher(uri: string, wait_: boolean, publishTimeoutMs: number) {
      const moduleRef = await Test.createTestingModule({
        imports: [
          RabbitMQModule.forRoot({
            uri,
            connectionInitOptions: { wait: wait_, timeout: 30_000 },
            enableDirectReplyTo: false,
            exchanges: [
              { name: EXCHANGE_SOLAR_GRID_ENERGY, type: 'topic', options: { durable: true } },
            ],
            queues: [
              {
                name: TEST_QUEUE,
                options: { durable: true },
                exchange: EXCHANGE_SOLAR_GRID_ENERGY,
                routingKey: '#',
              },
            ],
            defaultPublishOptions: { persistent: true, contentType: 'application/json' },
          }),
        ],
        providers: [
          OutboxPublisherService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: config(publishTimeoutMs) },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      await app.init();
      return app;
    }

    it('leaves the event pending when the broker cannot be reached', async () => {
      const event = await seedPendingEvent();
      // Nothing is listening on this port, and the client library queues
      // publishes while offline rather than failing, so the publisher relies
      // on its own deadline here.
      const app: INestApplication = await buildPublisher(
        'amqp://guest:guest@127.0.0.1:1',
        false,
        1000,
      );

      try {
        const published = await app.get(OutboxPublisherService).drain();
        expect(published).toBe(0);

        const stillPending = await prisma.outboxEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        expect(stillPending.status).toBe('PENDING');
        expect(stillPending.attempts).toBe(1);
        expect(stillPending.lastError).toContain('timed out');
      } finally {
        await app.close();
      }
    });

    it('publishes the pending event once a broker is available, and marks it persistent', async () => {
      const event = await seedPendingEvent();
      const rabbit: StartedRabbitMQContainer = await new RabbitMQContainer(
        'rabbitmq:3.12-management-alpine',
      ).start();
      const app = await buildPublisher(rabbit.getAmqpUrl(), true, 10_000);

      try {
        const amqp = app.get(AmqpConnection);
        await amqp.channel.purgeQueue(TEST_QUEUE);

        const published = await app.get(OutboxPublisherService).drain();
        expect(published).toBe(1);

        const stored = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        expect(stored.status).toBe('PUBLISHED');
        expect(stored.publishedAt).not.toBeNull();

        // Read the message back off the broker and check what was actually sent.
        let message = await amqp.channel.get(TEST_QUEUE, { noAck: true });
        for (let attempt = 0; attempt < 20 && message === false; attempt++) {
          await wait(250);
          message = await amqp.channel.get(TEST_QUEUE, { noAck: true });
        }
        if (message === false) throw new Error('no message arrived on the test queue');

        // deliveryMode 2 is what survives a broker restart.
        expect(message.properties.deliveryMode).toBe(2);
        expect(message.properties.messageId).toBe(event.eventId);
        expect(message.properties.correlationId).toBe('cid-publish');
        expect(message.properties.type).toBe('EnergySurplusDetected');
        expect(message.properties.headers?.[HEADER_CORRELATION_ID]).toBe('cid-publish');
        expect(message.fields.routingKey).toBe(ROUTING_KEY_SURPLUS_DETECTED);
        expect(JSON.parse(message.content.toString())).toMatchObject({
          eventId: event.eventId,
          householdId: 'HH-SELLER',
          surplusKwh: '7.000',
        });

        // Draining again must not republish what is already published.
        expect(await app.get(OutboxPublisherService).drain()).toBe(0);
      } finally {
        await app.close();
        await rabbit.stop();
      }
    });
  });
});
