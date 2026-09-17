import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RabbitMQContainer, StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import {
  ENERGY_EVENT_VERSION,
  EnergyEventType,
  EXCHANGE_SOLAR_GRID_ENERGY,
  HEADER_CORRELATION_ID,
  HEADER_FAILURE_REASON,
  HEADER_RETRY_COUNT,
  QUEUE_TRADE_MATCHING_DLQ,
  QUEUE_TRADE_MATCHING_ENERGY,
  ROUTING_KEY_DEMAND_DETECTED,
  ROUTING_KEY_SURPLUS_DETECTED,
  retryQueueName,
} from '@solar-grid/shared-contracts';
import { configureHttpApp, StructuredLogger } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';
import {
  freePort,
  parseLogLines,
  startContainer,
  stopContainer,
  wait,
  waitUntil,
} from './support/outages';

jest.setTimeout(300_000);

const OPERATOR_TOKEN = 'resilience-operator-token-0123456789abcdef';
const INTERNAL_TOKEN = 'resilience-internal-token-0123456789abcdef';
const METRICS_TOKEN = 'resilience-metrics-token-0123456789abcdef0';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;
const ORIGINAL_ENV = { ...process.env };

/** A tiny HTTP server standing in for a dependency that can be switched off. */
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

/** pricing-engine-service, up or down, remembering when it was asked and by whom. */
class StubPricing {
  up = true;
  readonly calls: Array<{ at: number; correlationId?: string }> = [];

  handle = (req: IncomingMessage, res: ServerResponse) => {
    this.calls.push({ at: Date.now(), correlationId: header(req, HEADER_CORRELATION_ID) });
    if (!this.up) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 503 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        pricePerKwh: '4.0000',
        currency: 'TRY',
        calculatedAt: new Date().toISOString(),
        supplyKwh: '0.000',
        demandKwh: '0.000',
      }),
    );
  };
}

/**
 * billing-ledger-service. Like the real one it records an idempotency key
 * once, so `recorded` is the ledger: two entries for one trade would be
 * double billing.
 */
class StubBilling {
  mode: 'up' | 'down' | 'record-then-fail' = 'up';
  hold: Promise<void> | null = null;
  readonly recorded = new Map<string, Record<string, unknown>>();
  readonly calls: Array<{
    idempotencyKey: string;
    correlationHeader?: string;
    bodyCorrelationId: string;
    authorised: boolean;
  }> = [];

  handle = async (req: IncomingMessage, res: ServerResponse) => {
    const body = JSON.parse(await readBody(req)) as Record<string, string>;
    this.calls.push({
      idempotencyKey: body.idempotencyKey,
      correlationHeader: header(req, HEADER_CORRELATION_ID),
      bodyCorrelationId: body.correlationId,
      authorised: header(req, 'authorization') === `Bearer ${INTERNAL_TOKEN}`,
    });
    if (this.hold) await this.hold;

    if (this.mode === 'down') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 503 }));
      return;
    }
    const duplicate = this.recorded.has(body.idempotencyKey);
    if (!duplicate) this.recorded.set(body.idempotencyKey, body);
    if (this.mode === 'record-then-fail') {
      // Recorded, but the answer never makes it back.
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 503 }));
      return;
    }
    res.writeHead(duplicate ? 200 : 201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tradeId: body.tradeId, duplicate }));
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function surplusEvent(householdId: string, correlationId: string, kwh = '4.000') {
  return {
    eventId: randomUUID(),
    eventType: EnergyEventType.EnergySurplusDetected,
    version: ENERGY_EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    correlationId,
    sourceEventId: `reading-${randomUUID()}`,
    householdId,
    productionKwh: kwh,
    consumptionKwh: '0.000',
    surplusKwh: kwh,
    timestamp: new Date().toISOString(),
  };
}

function demandEvent(householdId: string, correlationId: string, kwh = '4.000') {
  return {
    eventId: randomUUID(),
    eventType: EnergyEventType.EnergyDemandDetected,
    version: ENERGY_EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    correlationId,
    sourceEventId: `reading-${randomUUID()}`,
    householdId,
    productionKwh: '0.000',
    consumptionKwh: kwh,
    demandKwh: kwh,
    timestamp: new Date().toISOString(),
  };
}

describe('trade-matching when its dependencies fail', () => {
  let database: RuntimeDatabase;
  let rabbit: StartedRabbitMQContainer;
  let owner: PrismaClient;
  let app: INestApplication;
  let amqp: AmqpConnection;
  const pricing = new StubPricing();
  const billing = new StubBilling();
  const servers: Server[] = [];
  const lines: string[] = [];
  /** The metrics as each test started. */
  let baseline = '';

  beforeAll(async () => {
    const brokerPort = await freePort();
    [database, rabbit] = await Promise.all([
      startRuntimeDatabase(),
      new RabbitMQContainer('rabbitmq:3.12-management-alpine')
        .withExposedPorts({ container: 5672, host: brokerPort })
        .start(),
    ]);
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });
    const pricingServer = await listen(pricing.handle);
    const billingServer = await listen((req, res) => void billing.handle(req, res));
    servers.push(pricingServer.server, billingServer.server);

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      RABBITMQ_URL: `amqp://guest:guest@127.0.0.1:${brokerPort}`,
      PRICING_ENGINE_URL: pricingServer.url,
      BILLING_LEDGER_URL: billingServer.url,
      OPERATOR_API_TOKEN: OPERATOR_TOKEN,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      METRICS_TOKEN,
      HTTP_CLIENT_TIMEOUT_MS: '2000',
      RABBITMQ_MAX_RETRIES: String(MAX_RETRIES),
      RABBITMQ_RETRY_DELAY_MS: String(RETRY_DELAY_MS),
      RATE_LIMIT_ENABLED: 'false',
    };

    // The real application: every global guard, filter, middleware, the
    // structured logger and the metrics registry are in front of the consumer,
    // exactly as in production.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({
      logger: new StructuredLogger({
        service: 'trade-matching-service',
        write: (line) => lines.push(line),
        secrets: [OPERATOR_TOKEN, INTERNAL_TOKEN, METRICS_TOKEN],
      }),
    });
    configureHttpApp(app, {
      title: 'trade-matching',
      description: 'test',
      tags: [],
      credentials: ['operator', 'internal-service', 'metrics'],
    });
    await app.init();
    amqp = app.get(AmqpConnection);
    await waitUntil(async () => (await consumers()) === 1, 'the consumer to subscribe');
  });

  afterAll(async () => {
    billing.hold = null;
    await app?.close();
    await owner?.$disconnect();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all([database?.container.stop(), rabbit?.stop()]);
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    pricing.up = true;
    pricing.calls.length = 0;
    billing.mode = 'up';
    billing.hold = null;
    billing.calls.length = 0;
    billing.recorded.clear();
    lines.length = 0;
    await owner.tradeMatch.deleteMany();
    await owner.sellOffer.deleteMany();
    await owner.buyRequest.deleteMany();
    for (const queue of [
      QUEUE_TRADE_MATCHING_ENERGY,
      QUEUE_TRADE_MATCHING_DLQ,
      ...Array.from({ length: MAX_RETRIES }, (_, index) => retryQueueName(index + 1)),
    ]) {
      await amqp.channel.purgeQueue(queue);
    }
    baseline = await metrics();
  });

  async function consumers(): Promise<number> {
    return (await amqp.channel.checkQueue(QUEUE_TRADE_MATCHING_ENERGY)).consumerCount;
  }

  async function depth(queue: string): Promise<number> {
    return (await amqp.channel.checkQueue(queue)).messageCount;
  }

  async function publish(routingKey: string, event: { eventId: string; correlationId: string }) {
    await amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, routingKey, event, {
      messageId: event.eventId,
      correlationId: event.correlationId,
      persistent: true,
      headers: { [HEADER_CORRELATION_ID]: event.correlationId },
    });
  }

  async function publishPair(seller: string, buyer: string) {
    const surplus = surplusEvent(seller, `cid-${seller}`);
    const demand = demandEvent(buyer, `cid-${buyer}`);
    await publish(ROUTING_KEY_SURPLUS_DETECTED, surplus);
    await waitUntil(async () => (await owner.sellOffer.count()) === 1, 'the offer');
    await publish(ROUTING_KEY_DEMAND_DETECTED, demand);
    return { surplus, demand };
  }

  const logs = () => parseLogLines(lines);

  async function metrics(): Promise<string> {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`)
      .expect(200);
    return response.text;
  }

  /** The sum of every series of a metric that carries the given labels. */
  function count(text: string, name: string, labels: Record<string, string>): number {
    return text
      .split('\n')
      .filter(
        (candidate) =>
          candidate.startsWith(`${name}{`) &&
          Object.entries(labels).every(([key, value]) => candidate.includes(`${key}="${value}"`)),
      )
      .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(' ') + 1)), 0);
  }

  /** How much a metric grew since the start of the test: one registry serves them all. */
  async function grew(name: string, labels: Record<string, string>): Promise<number> {
    return count(await metrics(), name, labels) - count(baseline, name, labels);
  }

  it('follows one correlation id from the event through pricing and billing', async () => {
    const { demand } = await publishPair('HH-CID-SELLER', 'HH-CID-BUYER');

    await waitUntil(
      async () => (await owner.tradeMatch.findFirst())?.status === 'COMPLETED',
      'the trade to complete',
    );

    // The demand event triggered the run, so its id is the trade's.
    const cid = demand.correlationId;
    expect((await owner.tradeMatch.findFirstOrThrow()).correlationId).toBe(cid);
    expect(pricing.calls.map((call) => call.correlationId)).toEqual([cid]);
    expect(billing.calls).toEqual([
      expect.objectContaining({ correlationHeader: cid, bodyCorrelationId: cid, authorised: true }),
    ]);

    const traced = logs()
      .filter((entry) => entry.correlationId === cid)
      .map((entry) => entry.event);
    expect(traced).toEqual(
      expect.arrayContaining([
        'message.consumed',
        'request.created',
        'matching.started',
        'pricing.request.completed',
        'trade.reserved',
        'trade.settled',
        'matching.completed',
        'message.processed',
      ]),
    );

    // The consumer ran behind every global HTTP guard, filter and middleware
    // without any of them treating it as a request.
    expect(logs().some((entry) => String(entry.event).startsWith('http.request'))).toBe(false);
    expect(logs().filter((entry) => entry.level === 'error')).toEqual([]);
    // The token billing was called with appears nowhere.
    expect(lines.join('\n')).not.toContain(INTERNAL_TOKEN);

    expect(await grew('solargrid_messages_total', { outcome: 'processed' })).toBe(2);
    expect(await grew('solargrid_trade_billing_outcomes_total', { outcome: 'settled' })).toBe(1);
  });

  it('reserves nothing while pricing is down, retries on schedule, parks the event, and recovers', async () => {
    pricing.up = false;
    const { demand } = await publishPair('HH-PRICE-SELLER', 'HH-PRICE-BUYER');

    await waitUntil(
      async () => (await depth(QUEUE_TRADE_MATCHING_DLQ)) === 1,
      'the event to be parked',
    );

    // One attempt and two retries, each delay double the one before.
    const attempts = pricing.calls.filter((call) => call.correlationId === demand.correlationId);
    expect(attempts).toHaveLength(MAX_RETRIES + 1);
    const gaps = attempts.slice(1).map((call, index) => call.at - attempts[index].at);
    expect(gaps[0]).toBeGreaterThanOrEqual(RETRY_DELAY_MS - 50);
    expect(gaps[1]).toBeGreaterThanOrEqual(RETRY_DELAY_MS * 2 - 50);
    expect(gaps.every((gap) => gap < 10_000)).toBe(true);

    const parked = await amqp.channel.get(QUEUE_TRADE_MATCHING_DLQ, { noAck: true });
    if (parked === false) throw new Error('nothing parked');
    expect(parked.properties.headers?.[HEADER_RETRY_COUNT]).toBe(MAX_RETRIES);
    expect(String(parked.properties.headers?.[HEADER_FAILURE_REASON])).toContain('pricing');
    expect(parked.properties.correlationId).toBe(demand.correlationId);

    // Nothing was reserved: no trade, and both sides still hold all their energy.
    expect(await owner.tradeMatch.count()).toBe(0);
    const offer = await owner.sellOffer.findFirstOrThrow();
    const buyRequest = await owner.buyRequest.findFirstOrThrow();
    expect(offer.availableKwh.toFixed(3)).toBe('4.000');
    expect(buyRequest.requestedKwh.toFixed(3)).toBe('4.000');

    // An operator run says so plainly, and readiness is unaffected: pricing
    // being down is not a reason to take this service out of rotation.
    const run = await request(app.getHttpServer())
      .post('/matching/run')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .set(HEADER_CORRELATION_ID, 'cid-operator-run');
    expect(run.status).toBe(503);
    expect(run.body.code).toBe('DOWNSTREAM_UNAVAILABLE');
    expect((await request(app.getHttpServer()).get('/health/ready')).status).toBe(200);

    const retries = logs().filter(
      (entry) =>
        entry.event === 'message.retry.scheduled' && entry.correlationId === demand.correlationId,
    );
    expect(retries.map((entry) => entry.delayMs)).toEqual([RETRY_DELAY_MS, RETRY_DELAY_MS * 2]);
    expect(
      logs().find(
        (entry) =>
          entry.event === 'message.dead_lettered' && entry.correlationId === demand.correlationId,
      ),
    ).toMatchObject({ retries: MAX_RETRIES, level: 'error' });

    expect(await grew('solargrid_messages_total', { outcome: 'retry_scheduled' })).toBe(
      MAX_RETRIES,
    );
    expect(await grew('solargrid_messages_total', { outcome: 'dead_lettered' })).toBe(1);
    // Three attempts from the consumer and one from the operator run.
    expect(await grew('solargrid_dependency_failures_total', { dependency: 'pricing' })).toBe(
      MAX_RETRIES + 2,
    );

    // Pricing returns; the parked event's offer and request are still open,
    // and the next run matches them.
    pricing.up = true;
    const recovered = await request(app.getHttpServer())
      .post('/matching/run')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .expect(200);
    expect(recovered.body.matched).toBe(1);
    expect((await owner.tradeMatch.findFirstOrThrow()).status).toBe('COMPLETED');
    expect(billing.recorded.size).toBe(1);
  });

  it('keeps a trade reserved while billing is down and bills it exactly once when billing returns', async () => {
    // First the answer is lost after billing recorded the trade, then billing is down.
    billing.mode = 'record-then-fail';
    await publishPair('HH-BILL-SELLER', 'HH-BILL-BUYER');

    await waitUntil(
      async () => (await owner.tradeMatch.findFirst())?.status === 'PENDING_BILLING',
      'the trade to be reserved',
    );
    billing.mode = 'down';
    await request(app.getHttpServer())
      .post('/matching/run')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .expect(200);

    const pending = await owner.tradeMatch.findFirstOrThrow();
    expect(pending.status).toBe('PENDING_BILLING');
    // The energy stays reserved: it is neither sold again nor given back.
    expect((await owner.sellOffer.findFirstOrThrow()).availableKwh.toFixed(3)).toBe('0.000');
    // The event itself succeeded; waiting for billing is not a message failure.
    await wait(RETRY_DELAY_MS * 4);
    expect(await depth(QUEUE_TRADE_MATCHING_DLQ)).toBe(0);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      expect(await depth(retryQueueName(attempt))).toBe(0);
    }

    billing.mode = 'up';
    const run = await request(app.getHttpServer())
      .post('/matching/run')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .expect(200);
    expect(run.body.settled).toBe(1);

    const settled = await owner.tradeMatch.findFirstOrThrow();
    expect(settled.status).toBe('COMPLETED');
    expect(settled.billingAttempts).toBe(3);
    // Three calls, one key, one ledger entry.
    expect(new Set(billing.calls.map((call) => call.idempotencyKey))).toEqual(
      new Set([settled.idempotencyKey]),
    );
    expect(billing.recorded.size).toBe(1);

    expect(await grew('solargrid_trade_billing_outcomes_total', { outcome: 'unknown' })).toBe(2);
    expect(await grew('solargrid_trade_billing_outcomes_total', { outcome: 'settled' })).toBe(1);
    expect(
      logs().filter(
        (entry) => entry.event === 'billing.request.failed' && entry.tradeId === settled.tradeId,
      ),
    ).toHaveLength(2);
  });

  it('bills once when the consumer loses its broker connection in the middle of a trade', async () => {
    let release!: () => void;
    billing.hold = new Promise<void>((resolve) => (release = resolve));

    const { demand } = await publishPair('HH-CRASH-SELLER', 'HH-CRASH-BUYER');
    await waitUntil(() => billing.calls.length === 1, 'the trade to reach billing');

    // The demand message is unacknowledged while billing holds the answer.
    await rabbit.exec(['rabbitmqctl', 'close_all_connections', 'resilience test']);

    // The client reconnects by itself, and the broker hands the message over again.
    await waitUntil(
      async () => amqp.connected && (await consumers()) === 1,
      'the consumer to reconnect',
    );
    await waitUntil(
      () =>
        logs().some(
          (entry) => entry.event === 'message.duplicate' && entry.eventId === demand.eventId,
        ),
      'the redelivered message to be recognised',
    );

    // By now the first handler's billing call has timed out, so the trade is
    // reserved with an unknown outcome. Billing answers late - it did record it.
    release();
    await waitUntil(() => billing.recorded.size === 1, 'billing to record the trade');
    await waitUntil(
      async () => (await owner.tradeMatch.findFirst())?.status !== undefined,
      'the reserved trade',
    );

    // The first handler's acknowledgement went nowhere; that must not take
    // the process down, only be noted.
    await waitUntil(
      () => logs().some((entry) => entry.event === 'message.ack_lost'),
      'the lost acknowledgement to be logged',
    );

    // The next run settles it with the same key, and billing recognises it.
    await request(app.getHttpServer())
      .post('/matching/run')
      .set('Authorization', `Bearer ${OPERATOR_TOKEN}`)
      .expect(200);
    const trade = await owner.tradeMatch.findFirstOrThrow();
    expect(trade.status).toBe('COMPLETED');

    await waitUntil(async () => (await depth(QUEUE_TRADE_MATCHING_ENERGY)) === 0, 'an empty queue');
    expect(await owner.sellOffer.count()).toBe(1);
    expect(await owner.buyRequest.count()).toBe(1);
    expect(await owner.tradeMatch.count()).toBe(1);
    expect(new Set(billing.calls.map((call) => call.idempotencyKey))).toEqual(
      new Set([trade.idempotencyKey]),
    );
    expect(billing.recorded.size).toBe(1);
    expect(await depth(QUEUE_TRADE_MATCHING_DLQ)).toBe(0);
  });

  it('reports the broker outage, reconnects when it returns and carries on consuming', async () => {
    stopContainer(rabbit);
    try {
      await waitUntil(() => !amqp.connected, 'the connection to drop');

      const live = await request(app.getHttpServer()).get('/health/live');
      expect(live.status).toBe(200);
      const ready = await request(app.getHttpServer()).get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.checks.rabbitmq).toMatchObject({ status: 'down', critical: true });

      startContainer(rabbit);
      await waitUntil(
        async () => (await request(app.getHttpServer()).get('/health/ready')).status === 200,
        'readiness to return',
        120_000,
      );
    } finally {
      startContainer(rabbit);
    }

    await waitUntil(
      async () => (await consumers()) >= 1,
      'the consumer to subscribe again',
      60_000,
    );
    await publishPair('HH-RESTART-SELLER', 'HH-RESTART-BUYER');
    await waitUntil(
      async () => (await owner.tradeMatch.findFirst())?.status === 'COMPLETED',
      'a trade after the restart',
    );

    const changes = logs()
      .filter((entry) => entry.event === 'readiness.changed' && entry.dependency === 'rabbitmq')
      .map((entry) => entry.status);
    expect(changes).toEqual(['down', 'up']);
  });
});
