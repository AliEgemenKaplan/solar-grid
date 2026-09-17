import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OutboxPublisherService } from '../src/messaging/outbox-publisher.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MetricsRegistry } from '@solar-grid/nest-common';
import { SmartMeterMetrics } from '../src/metrics/smart-meter.metrics';

function pendingEvent(id: string) {
  return {
    id,
    eventId: `evt-${id}`,
    eventType: 'EnergySurplusDetected',
    routingKey: 'energy.surplus.detected',
    payload: { version: 1, sourceEventId: `reading-${id}` },
    correlationId: `cid-${id}`,
    attempts: 0,
  };
}

describe('OutboxPublisherService shutdown', () => {
  let findMany: jest.Mock;
  let update: jest.Mock;
  let publish: jest.Mock;
  let publisher: OutboxPublisherService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([pendingEvent('1'), pendingEvent('2')]);
    update = jest.fn().mockResolvedValue({});
    publish = jest.fn();
    const prisma = { outboxEvent: { findMany, update } } as unknown as PrismaService;
    const amqp = { publish } as unknown as AmqpConnection;
    const config = { get: (_key: string, fallback: string) => fallback } as ConfigService;
    publisher = new OutboxPublisherService(prisma, amqp, config);
  });

  it('finishes the publish in progress, marks it, and leaves the rest pending', async () => {
    let confirmFirst!: () => void;
    publish.mockImplementationOnce(() => new Promise<void>((resolve) => (confirmFirst = resolve)));

    const draining = publisher.drain();
    await waitUntil(() => publish.mock.calls.length === 1);

    let stopped = false;
    const stopping = publisher.beforeApplicationShutdown().then(() => (stopped = true));
    await flush();
    // Still waiting for the broker to confirm the first event.
    expect(stopped).toBe(false);

    confirmFirst();
    await stopping;
    await draining;

    // The confirmed event was recorded as published...
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
    // ...and the second was never started, so it is still PENDING for the next start.
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing once shutdown has begun', async () => {
    await publisher.beforeApplicationShutdown();

    await expect(publisher.drain()).resolves.toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('still refuses overlapping drains while running normally', async () => {
    publish.mockResolvedValue(undefined);

    const [first, second] = await Promise.all([publisher.drain(), publisher.drain()]);

    expect(first).toBe(2);
    expect(second).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error('condition was never met');
}

describe('OutboxPublisherService metrics', () => {
  it('counts published events, broker failures and pending events', async () => {
    const registry = new MetricsRegistry('smart-meter-service');
    const findMany = jest.fn().mockResolvedValue([pendingEvent('1'), pendingEvent('2')]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      outboxEvent: { findMany, update: jest.fn().mockResolvedValue({}), count },
    } as unknown as PrismaService;
    const publish = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('connection closed'));
    const config = { get: (_key: string, fallback: string) => fallback } as ConfigService;
    const publisher = new OutboxPublisherService(
      prisma,
      { publish } as unknown as AmqpConnection,
      config,
      new SmartMeterMetrics(registry, prisma),
    );

    await publisher.drain();
    const text = await registry.render();

    expect(text).toMatch(/solargrid_outbox_events_published_total\{[^}]*\} 1/);
    expect(text).toMatch(/solargrid_outbox_publish_failures_total\{reason="broker"[^}]*\} 1/);
    expect(text).toMatch(/solargrid_dependency_failures_total\{dependency="rabbitmq"[^}]*\} 1/);
    expect(text).toMatch(/solargrid_outbox_events_pending\{[^}]*\} 1/);
  });
});
