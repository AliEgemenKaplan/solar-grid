import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfigService } from '@nestjs/config';
import { EXCHANGE_SOLAR_GRID_ENERGY, HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 5000;
const BATCH_SIZE = 50;

/**
 * Moves events from the outbox table to RabbitMQ.
 *
 * Readings and their events are written in one database transaction, so the
 * broker may be behind the database but the two can never disagree. This
 * publisher is the only thing that talks to the exchange, and it is safe for
 * it to publish the same event twice: consumers deduplicate on eventId.
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly pollIntervalMs: number;
  private readonly publishTimeoutMs: number;
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    this.pollIntervalMs = Number(
      config.get<string>('OUTBOX_POLL_INTERVAL_MS', String(DEFAULT_POLL_INTERVAL_MS)),
    );
    this.publishTimeoutMs = Number(
      config.get<string>('OUTBOX_PUBLISH_TIMEOUT_MS', String(DEFAULT_PUBLISH_TIMEOUT_MS)),
    );
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), this.pollIntervalMs);
    // Do not hold the process open just for the poll timer.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Publishes pending events oldest first. Overlapping calls are a no-op, so
   * the timer and the request path can both ask for a drain.
   */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      const pending = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      let published = 0;
      for (const event of pending) {
        const ok = await this.publishOne(event);
        // A failure here means the broker is unreachable; the next tick
        // retries from the same place rather than hammering it now.
        if (!ok) break;
        published++;
      }
      return published;
    } catch (err) {
      this.logger.error(`Outbox drain failed: ${describe(err)}`);
      return 0;
    } finally {
      this.draining = false;
    }
  }

  private async publishOne(event: {
    id: string;
    eventId: string;
    eventType: string;
    routingKey: string;
    payload: unknown;
    correlationId: string;
  }): Promise<boolean> {
    try {
      await this.withDeadline(
        this.amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY, event.routingKey, event.payload, {
          messageId: event.eventId,
          correlationId: event.correlationId,
          type: event.eventType,
          contentType: 'application/json',
          headers: { [HEADER_CORRELATION_ID]: event.correlationId },
        }),
      );

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });

      this.logger.log(
        `Published ${event.eventType}: eventId=${event.eventId} [cid=${event.correlationId}]`,
      );
      return true;
    } catch (err) {
      const reason = describe(err);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: reason },
      });
      this.logger.warn(
        `Outbox publish failed, event stays pending: eventId=${event.eventId} reason=${reason} [cid=${event.correlationId}]`,
      );
      return false;
    }
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
