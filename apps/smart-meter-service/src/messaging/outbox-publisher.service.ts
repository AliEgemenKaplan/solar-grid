import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { EXCHANGE_SOLAR_GRID_ENERGY, HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { PrismaService } from '../prisma/prisma.service';
import { SmartMeterMetrics } from '../metrics/smart-meter.metrics';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 5000;
const BATCH_SIZE = 50;

interface PendingEvent {
  id: string;
  eventId: string;
  eventType: string;
  routingKey: string;
  payload: unknown;
  correlationId: string;
  attempts: number;
}

/** Why a publish did not happen, which decides whether to keep draining. */
type PublishFailure = 'unroutable' | 'broker';

/**
 * Moves events from the outbox table to RabbitMQ.
 *
 * Readings and their events are written in one database transaction, so the
 * broker may be behind the database but the two can never disagree. This
 * publisher is the only thing that talks to the exchange, and it is safe for
 * it to publish the same event twice: consumers deduplicate on eventId.
 *
 * Three failure modes are handled explicitly:
 *
 * - the broker is unreachable: the row stays pending and the next pass retries
 * - the broker accepts nothing because no queue is bound: the broker returns
 *   the message, the row stays pending, and it publishes itself once a
 *   consumer has declared its queue
 * - the process dies between publishing and marking the row: the event is
 *   published again later, and the consumer ignores the duplicate
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly pollIntervalMs: number;
  private readonly publishTimeoutMs: number;
  private timer?: NodeJS.Timeout;
  /** The drain pass in progress, if any. */
  private inProgress: Promise<number> | null = null;
  private stopped = false;
  /** Message ids the broker handed back because nothing was bound to route them. */
  private readonly returned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpConnection,
    config: ConfigService,
    @Optional() private readonly metrics: SmartMeterMetrics = new SmartMeterMetrics(),
  ) {
    this.pollIntervalMs = Number(
      config.get<string>('OUTBOX_POLL_INTERVAL_MS', String(DEFAULT_POLL_INTERVAL_MS)),
    );
    this.publishTimeoutMs = Number(
      config.get<string>('OUTBOX_PUBLISH_TIMEOUT_MS', String(DEFAULT_PUBLISH_TIMEOUT_MS)),
    );
  }

  async onModuleInit(): Promise<void> {
    // A mandatory message that cannot be routed comes back on this event
    // rather than disappearing. Registered through addSetup so it survives a
    // reconnect, which creates a new channel.
    await this.amqp.managedChannel.addSetup(async (channel: ConfirmChannel) => {
      channel.on('return', (message: ConsumeMessage) => {
        const messageId = message.properties.messageId as string | undefined;
        if (messageId) this.returned.add(messageId);
        this.logger.error({
          event: 'outbox.publish.unroutable',
          message: 'The broker returned a message no queue is bound for',
          eventId: messageId ?? 'unknown',
          routingKey: message.fields.routingKey,
          correlationId: message.properties.correlationId as string | undefined,
        });
      });
    });

    this.timer = setInterval(() => void this.drain(), this.pollIntervalMs);
    // Do not hold the process open just for the poll timer.
    this.timer.unref();
  }

  /**
   * Stops publishing and waits for the event being published to settle.
   *
   * Events not reached stay PENDING and go out after the next start. A reading
   * accepted while the service is shutting down is still stored with its event;
   * it simply waits for that start too.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inProgress) {
      this.logger.log({
        event: 'shutdown.outbox.waiting',
        message: 'Waiting for the outbox publish in progress before shutting down',
      });
      await this.inProgress;
    }
  }

  /**
   * Publishes pending events oldest first. Overlapping calls are a no-op, so
   * the timer and the request path can both ask for a drain.
   */
  drain(): Promise<number> {
    if (this.stopped || this.inProgress) return Promise.resolve(0);
    this.inProgress = this.drainPending().finally(() => {
      this.inProgress = null;
    });
    return this.inProgress;
  }

  private async drainPending(): Promise<number> {
    try {
      const pending = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      let published = 0;
      for (const event of pending) {
        // Finish the event in hand, but do not start another once shutdown
        // has begun: the rest are safe where they are.
        if (this.stopped) break;
        const failure = await this.publishOne(event);
        if (!failure) {
          published++;
          continue;
        }
        // An unroutable event is this event's problem; the ones behind it may
        // route perfectly well. An unreachable broker is everyone's problem,
        // so stop and let the next tick try again.
        if (failure === 'broker') break;
      }
      return published;
    } catch (err) {
      this.logger.error({
        event: 'outbox.drain.failed',
        message: `Outbox drain failed: ${describe(err)}`,
        error: err,
      });
      return 0;
    }
  }

  private async publishOne(event: PendingEvent): Promise<PublishFailure | null> {
    const envelope = (event.payload ?? {}) as Record<string, unknown>;

    try {
      await this.withDeadline(
        this.amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, event.routingKey, event.payload, {
          messageId: event.eventId,
          correlationId: event.correlationId,
          type: event.eventType,
          contentType: 'application/json',
          persistent: true,
          // Tell us when nothing is bound instead of dropping the message.
          mandatory: true,
          headers: {
            [HEADER_CORRELATION_ID]: event.correlationId,
            'x-event-version': envelope.version ?? null,
            'x-source-event-id': envelope.sourceEventId ?? null,
          },
        }),
      );

      // The broker returns an unroutable message before it confirms it, so by
      // the time the publish resolves we know which it was.
      if (this.returned.delete(event.eventId)) {
        await this.recordFailure(
          event,
          `no queue is bound for ${event.routingKey}; the broker returned the message`,
          'unroutable',
        );
        return 'unroutable';
      }

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });

      this.metrics.outboxEventPublished();
      this.logger.log({
        event: 'outbox.event.published',
        message: `Published ${event.eventType}`,
        eventId: event.eventId,
        eventType: event.eventType,
        sourceEventId: envelope.sourceEventId,
        attempts: event.attempts + 1,
        correlationId: event.correlationId,
      });
      return null;
    } catch (err) {
      await this.recordFailure(event, describe(err), 'broker');
      return 'broker';
    }
  }

  private async recordFailure(
    event: PendingEvent,
    reason: string,
    kind: PublishFailure,
  ): Promise<void> {
    this.metrics.outboxPublishFailed(kind);
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, lastError: reason },
    });
    this.logger.warn({
      event: 'outbox.publish.failed',
      message: 'Outbox publish failed; the event stays pending',
      eventId: event.eventId,
      eventType: event.eventType,
      attempts: event.attempts + 1,
      reason,
      correlationId: event.correlationId,
    });
  }

  /**
   * amqp-connection-manager queues publishes while the broker is down and only
   * settles them on reconnect, so an unreachable broker would otherwise stall
   * the drain loop indefinitely.
   */
  private withDeadline<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`publish timed out after ${this.publishTimeoutMs}ms`)),
        this.publishTimeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
