import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { EXCHANGE_SOLAR_GRID_ENERGY, HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { configureHttpApp, MetricsRegistry, StructuredLogger } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';
import {
  freePort,
  parseLogLines,
  startContainer,
  stopContainer,
  waitUntil,
} from './support/outages';

jest.setTimeout(300_000);

/** Stands in for trade-matching's queue: everything published to the exchange lands here. */
const CAPTURE_QUEUE = 'resilience.capture';
const ORIGINAL_ENV = { ...process.env };

interface Captured {
  eventId: string;
  correlationProperty?: string;
  correlationHeader?: unknown;
  payload: { eventId: string; correlationId: string };
}

describe('smart-meter across the broker boundary', () => {
  let database: RuntimeDatabase;
  let rabbit: StartedRabbitMQContainer;
  let owner: PrismaClient;
  let app: INestApplication;
  let baseUrl: string;
  let amqp: AmqpConnection;
  const lines: string[] = [];

  beforeAll(async () => {
    const brokerPort = await freePort();
    [database, rabbit] = await Promise.all([
      startRuntimeDatabase(),
      new RabbitMQContainer('rabbitmq:3.12-management-alpine')
        .withExposedPorts({ container: 5672, host: brokerPort })
        .start(),
    ]);
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      RABBITMQ_URL: `amqp://guest:guest@127.0.0.1:${brokerPort}`,
      OUTBOX_POLL_INTERVAL_MS: '300',
      OUTBOX_PUBLISH_TIMEOUT_MS: '500',
      RATE_LIMIT_ENABLED: 'false',
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({
      logger: new StructuredLogger({
        service: 'smart-meter-service',
        write: (line) => lines.push(line),
      }),
    });
    configureHttpApp(app, { title: 'smart-meter', description: 'test', tags: [], credentials: [] });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

    amqp = app.get(AmqpConnection);
    await waitUntil(() => amqp.connected, 'the broker connection');
    await amqp.channel.assertQueue(CAPTURE_QUEUE, { durable: true });
    await amqp.channel.bindQueue(CAPTURE_QUEUE, EXCHANGE_SOLAR_GRID_ENERGY, '#');
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    await Promise.all([database?.container.stop(), rabbit?.stop()]);
    process.env = ORIGINAL_ENV;
  });

  /** Everything in the capture queue, taken off it. */
  async function drainCapture(): Promise<Captured[]> {
    const captured: Captured[] = [];
    for (;;) {
      const message = await amqp.channel.get(CAPTURE_QUEUE, { noAck: true });
      if (message === false) return captured;
      captured.push({
        eventId: String(message.properties.messageId),
        correlationProperty: message.properties.correlationId,
        correlationHeader: message.properties.headers?.[HEADER_CORRELATION_ID],
        payload: JSON.parse(message.content.toString()),
      });
    }
  }

  function postReading(householdId: string, production: number, consumption: number) {
    return fetch(`${baseUrl}/readings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [HEADER_CORRELATION_ID]: `cid-${householdId}`,
      },
      body: JSON.stringify({
        householdId,
        productionKwh: production,
        consumptionKwh: consumption,
        // A minute ago: readings from the future are refused.
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
  }

  const readiness = async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    return { status: response.status, body: await response.json() };
  };

  it('carries the HTTP correlation id onto the published event', async () => {
    expect((await postReading('HH-TRACE', 8, 3)).status).toBe(201);

    let captured: Captured[] = [];
    await waitUntil(async () => {
      captured = captured.concat(await drainCapture());
      return captured.length > 0;
    }, 'the event to be published');

    const [event] = captured;
    const stored = await owner.outboxEvent.findUniqueOrThrow({ where: { eventId: event.eventId } });
    expect(stored.status).toBe('PUBLISHED');
    // One id: the request header, the stored event, the payload, the AMQP
    // property and the AMQP header.
    expect(stored.correlationId).toBe('cid-HH-TRACE');
    expect(event.payload.correlationId).toBe('cid-HH-TRACE');
    expect(event.correlationProperty).toBe('cid-HH-TRACE');
    expect(event.correlationHeader).toBe('cid-HH-TRACE');

    const traced = parseLogLines(lines)
      .filter((entry) => entry.correlationId === 'cid-HH-TRACE')
      .map((entry) => entry.event);
    expect(traced).toEqual(
      expect.arrayContaining([
        'reading.received',
        'outbox.event.created',
        'outbox.event.published',
        'http.request.completed',
      ]),
    );
  });

  it('keeps taking readings while the broker is down and publishes every one once it returns', async () => {
    await drainCapture();
    stopContainer(rabbit);
    try {
      await waitUntil(() => !amqp.connected, 'the connection to drop');

      // Readings are this service's job; the broker only delays their events.
      const during = await readiness();
      expect(during.status).toBe(200);
      expect(during.body.checks.rabbitmq).toMatchObject({ status: 'down', critical: false });

      expect((await postReading('HH-OUTAGE-SELLER', 9, 2)).status).toBe(201);
      expect((await postReading('HH-OUTAGE-BUYER', 0, 4)).status).toBe(201);
      const outageEvents = (await owner.outboxEvent.findMany()).filter((event) =>
        event.correlationId.startsWith('cid-HH-OUTAGE'),
      );
      expect(outageEvents).toHaveLength(2);
      const outageIds = outageEvents.map((event) => event.eventId);
      const stored = () => owner.outboxEvent.findMany({ where: { eventId: { in: outageIds } } });

      // Each pass stops at the first broker failure - the events behind it
      // would fail the same way - so only the oldest records attempts.
      await waitUntil(
        async () => {
          const events = await stored();
          return (
            events.every((event) => event.status === 'PENDING') &&
            events.some((event) => event.attempts > 0)
          );
        },
        'the publisher to try and fail',
        20_000,
      );
      expect(await app.get(MetricsRegistry).render()).toMatch(
        /solargrid_outbox_publish_failures_total\{reason="broker"[^}]*\} [1-9]/,
      );
      expect(
        parseLogLines(lines).some(
          (entry) =>
            entry.event === 'outbox.publish.failed' &&
            String(entry.correlationId).startsWith('cid-HH-OUTAGE'),
        ),
      ).toBe(true);

      startContainer(rabbit);
      await waitUntil(
        async () => (await stored()).every((event) => event.status === 'PUBLISHED'),
        'both events to be published after the broker returns',
        120_000,
      );

      // Every event arrived. A publish that was in flight when the broker went
      // away may arrive twice - consumers deduplicate on eventId - but none is lost.
      let captured: Captured[] = [];
      await waitUntil(async () => {
        captured = captured.concat(await drainCapture());
        const ids = new Set(captured.map((event) => event.eventId));
        return outageIds.every((id) => ids.has(id));
      }, 'both events to reach the queue');
      for (const event of outageEvents) {
        const copies = captured.filter((message) => message.eventId === event.eventId);
        expect(copies.length).toBeGreaterThanOrEqual(1);
        expect(copies.every((copy) => copy.payload.correlationId === event.correlationId)).toBe(
          true,
        );
      }
      expect((await readiness()).body.checks.rabbitmq.status).toBe('up');
    } finally {
      startContainer(rabbit);
    }
  });
});
