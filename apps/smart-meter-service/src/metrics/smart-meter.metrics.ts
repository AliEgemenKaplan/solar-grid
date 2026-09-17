import { Injectable, Optional } from '@nestjs/common';
import { CounterMetric, MetricsRegistry } from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const NOOP: CounterMetric = { inc: () => undefined };

/**
 * What smart-meter-service counts: readings taken, and events through the
 * outbox. Without a registry - in unit tests - every method does nothing.
 */
@Injectable()
export class SmartMeterMetrics {
  private readonly readings: CounterMetric = NOOP;
  private readonly outboxCreated: CounterMetric = NOOP;
  private readonly outboxPublished: CounterMetric = NOOP;
  private readonly outboxFailures: CounterMetric = NOOP;

  constructor(
    @Optional() private readonly registry?: MetricsRegistry,
    @Optional() prisma?: PrismaService,
  ) {
    if (!registry) return;

    this.readings = registry.counter(
      'readings_total',
      'Meter readings received, by whether they were new or a repeat.',
      ['result'],
    );
    this.outboxCreated = registry.counter(
      'outbox_events_created_total',
      'Events written to the outbox together with their reading.',
    );
    this.outboxPublished = registry.counter(
      'outbox_events_published_total',
      'Outbox events confirmed by the broker.',
    );
    this.outboxFailures = registry.counter(
      'outbox_publish_failures_total',
      'Outbox publish attempts that failed and left the event pending.',
      ['reason'],
    );
    registry.gauge(
      'outbox_events_pending',
      'Events in the outbox not yet published. Read from the database on each scrape.',
      [],
      async (set) => {
        if (!prisma) return;
        set({}, await prisma.outboxEvent.count({ where: { status: 'PENDING' } }));
      },
    );
  }

  readingReceived(result: 'created' | 'duplicate'): void {
    this.readings.inc({ result });
  }

  outboxEventCreated(): void {
    this.outboxCreated.inc();
  }

  outboxEventPublished(): void {
    this.outboxPublished.inc();
  }

  /** `broker`: the broker could not be reached. `unroutable`: nothing is bound for it. */
  outboxPublishFailed(reason: 'broker' | 'unroutable'): void {
    this.outboxFailures.inc({ reason });
    if (reason === 'broker') this.registry?.dependencyFailed('rabbitmq');
  }
}
