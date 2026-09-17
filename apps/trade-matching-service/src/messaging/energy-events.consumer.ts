import { BeforeApplicationShutdown, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AmqpConnection,
  MessageHandlerErrorBehavior,
  RabbitSubscribe,
} from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import {
  ENERGY_EVENT_VERSION,
  EnergyDemandDetectedEvent,
  EnergyEvent,
  EnergySurplusDetectedEvent,
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  EXCHANGE_SOLAR_GRID_ENERGY_RETRY,
  HEADER_CORRELATION_ID,
  HEADER_FAILED_AT,
  HEADER_FAILURE_REASON,
  HEADER_ORIGINAL_ROUTING_KEY,
  HEADER_RETRY_COUNT,
  QUEUE_TRADE_MATCHING_ENERGY,
  ROUTING_KEY_DEMAND_DETECTED,
  ROUTING_KEY_DLQ,
  ROUTING_KEY_RETRY_REDELIVERY,
  ROUTING_KEY_SURPLUS_DETECTED,
  retryRoutingKey,
} from '@solar-grid/shared-contracts';
import { isDecimalWithin, normalizeCorrelationId } from '@solar-grid/shared-utils';
import { isDatabaseUnavailable } from '@solar-grid/nest-common';
import { TradingMetrics } from '../metrics/trading.metrics';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { readRetryConfig, retryDelayMs, RetryConfig } from './retry.config';
import { Prisma } from '../../generated/client';

@Injectable()
export class EnergyEventsConsumer implements BeforeApplicationShutdown {
  private readonly logger = new Logger(EnergyEventsConsumer.name);
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
    private readonly amqp: AmqpConnection,
    config: ConfigService,
    @Optional() private readonly metrics: TradingMetrics = new TradingMetrics(),
  ) {
    this.retryConfig = readRetryConfig(config);
  }

  /**
   * Stops taking messages and waits for the ones already being handled.
   *
   * Cancelling the consumer means the broker delivers nothing more to this
   * process; messages still queued stay queued for the next consumer. A
   * message being handled finishes and is acknowledged - or retried, or parked
   * - exactly as it would have been, while the database and the broker are
   * still connected. Both close only after this returns.
   */
  async beforeApplicationShutdown(): Promise<void> {
    for (const tag of this.amqp.consumerTags) {
      try {
        await this.amqp.cancelConsumer(tag);
      } catch (err) {
        // The library keeps consumers from before a reconnect, whose channel is
        // gone; a closed channel delivers nothing, so there is nothing to stop.
        this.logger.log({
          event: 'shutdown.consumer.already_closed',
          message: `Consumer ${tag} was already closed`,
          consumerTag: tag,
          reason: describe(err),
        });
      }
    }

    const inFlight = deliveriesInProgress(this.amqp);
    if (inFlight.length > 0) {
      this.logger.log({
        event: 'shutdown.consumer.draining',
        message: 'Stopped consuming; waiting for messages in progress',
        inFlight: inFlight.length,
      });
      await Promise.allSettled(inFlight);
    }
    this.logger.log({
      event: 'shutdown.consumer.stopped',
      message: 'Energy event consumer stopped',
    });
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_SOLAR_GRID_ENERGY,
    routingKey: [
      ROUTING_KEY_SURPLUS_DETECTED,
      ROUTING_KEY_DEMAND_DETECTED,
      // A retried message comes back under its own key once its delay expires.
      ROUTING_KEY_RETRY_REDELIVERY,
    ],
    queue: QUEUE_TRADE_MATCHING_ENERGY,
    queueOptions: {
      durable: true,
      // Backstop only. Failures are routed deliberately by the handler below;
      // this catches anything nacked outside it, for instance a message whose
      // body is not JSON at all.
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_SOLAR_GRID_ENERGY_DLX,
        'x-dead-letter-routing-key': ROUTING_KEY_DLQ,
      },
    },
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  })
  async handleEnergyEvent(received: EnergyEvent, amqpMsg: ConsumeMessage): Promise<void> {
    const started = Date.now();
    const attempt = retryCountOf(amqpMsg) + 1;

    const problem = validateEnergyEvent(received);
    if (problem) {
      // No number of retries turns a malformed message into a valid one.
      await this.parkInDeadLetterQueue(received, amqpMsg, `unprocessable: ${problem}`, attempt);
      this.metrics.messageHandled(eventTypeOf(received), 'rejected');
      return;
    }

    // Validation accepts a correlation id with stray whitespace around it;
    // everything downstream - rows, logs, the call to billing - gets the clean
    // value, or billing would refuse the trade over it.
    const event = {
      ...received,
      correlationId: normalizeCorrelationId(received.correlationId) as string,
    };
    const fields = eventFields(event, attempt, this.retryConfig.maxRetries);

    this.logger.log({
      event: 'message.consumed',
      message: `Received ${event.eventType}`,
      redelivered: amqpMsg?.fields?.redelivered === true,
      ...fields,
    });

    try {
      const created =
        event.eventType === 'EnergySurplusDetected'
          ? await this.handleSurplus(event)
          : await this.handleDemand(event);

      // On a retry the offer is usually already there from the first attempt,
      // so the insert reports a duplicate - but whatever failed afterwards,
      // such as pricing being down, still needs doing. A first delivery of a
      // genuine duplicate has nothing new to match and skips it.
      if (created || attempt > 1) {
        await this.matchingService.runMatching(event.correlationId);
      }

      this.metrics.messageHandled(event.eventType, created ? 'processed' : 'duplicate');
      this.logger.log({
        event: 'message.processed',
        message: `Processed ${event.eventType}`,
        outcome: created ? 'created' : 'duplicate',
        durationMs: Date.now() - started,
        ...fields,
      });
    } catch (err) {
      const reason = describe(err);
      if (isDatabaseUnavailable(err)) this.metrics.databaseUnavailable();

      if (attempt > this.retryConfig.maxRetries) {
        await this.parkInDeadLetterQueue(event, amqpMsg, reason, attempt);
        this.metrics.messageHandled(event.eventType, 'dead_lettered');
        return;
      }

      await this.scheduleRetry(event, amqpMsg, reason, attempt);
      this.metrics.messageHandled(event.eventType, 'retry_scheduled');
    }
  }

  /**
   * Publishes a copy into the retry queue for this attempt and lets the
   * original be acknowledged. The copy waits there for a delay that doubles
   * with each attempt, then returns to the main queue.
   *
   * If this publish fails the handler throws, the message is nacked, and the
   * queue's dead letter route catches it - nothing is dropped either way.
   */
  private async scheduleRetry(
    event: EnergyEvent,
    amqpMsg: ConsumeMessage,
    reason: string,
    attempt: number,
  ): Promise<void> {
    const originalRoutingKey = originalRoutingKeyOf(amqpMsg);

    await this.amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY_RETRY, retryRoutingKey(attempt), event, {
      messageId: event.eventId,
      correlationId: event.correlationId,
      type: event.eventType,
      contentType: 'application/json',
      persistent: true,
      headers: {
        [HEADER_RETRY_COUNT]: attempt,
        [HEADER_ORIGINAL_ROUTING_KEY]: originalRoutingKey,
        [HEADER_FAILURE_REASON]: reason,
        [HEADER_CORRELATION_ID]: event.correlationId,
      },
    });

    this.logger.warn({
      event: 'message.retry.scheduled',
      message: `Retry ${attempt} of ${this.retryConfig.maxRetries} scheduled after a failure`,
      retry: attempt,
      maxRetries: this.retryConfig.maxRetries,
      delayMs: retryDelayMs(attempt, this.retryConfig.baseDelayMs),
      reason,
      ...eventFields(event, attempt, this.retryConfig.maxRetries),
    });
  }

  /**
   * Parks a message that will never succeed. It keeps why it failed and how
   * many attempts it took, so whoever looks at the queue can tell what
   * happened without digging through logs.
   */
  private async parkInDeadLetterQueue(
    event: EnergyEvent,
    amqpMsg: ConsumeMessage,
    reason: string,
    attempt: number,
  ): Promise<void> {
    await this.amqp.publish(EXCHANGE_SOLAR_GRID_ENERGY_DLX, ROUTING_KEY_DLQ, event, {
      messageId: typeof event?.eventId === 'string' ? event.eventId : undefined,
      correlationId: typeof event?.correlationId === 'string' ? event.correlationId : undefined,
      contentType: 'application/json',
      persistent: true,
      headers: {
        [HEADER_RETRY_COUNT]: attempt - 1,
        [HEADER_FAILURE_REASON]: reason,
        [HEADER_FAILED_AT]: new Date().toISOString(),
        [HEADER_ORIGINAL_ROUTING_KEY]: originalRoutingKeyOf(amqpMsg),
      },
    });

    this.logger.error({
      event: 'message.dead_lettered',
      message: `Parked in the dead letter queue after ${attempt - 1} retries`,
      retries: attempt - 1,
      reason,
      ...eventFields(event, attempt, this.retryConfig.maxRetries),
    });
  }

  private async handleSurplus(event: EnergySurplusDetectedEvent): Promise<boolean> {
    try {
      await this.prisma.sellOffer.create({
        data: {
          householdId: event.householdId,
          sourceEventId: event.eventId,
          availableKwh: event.surplusKwh,
          originalKwh: event.surplusKwh,
          status: 'OPEN',
          correlationId: event.correlationId,
        },
      });
    } catch (err) {
      // The unique index on sourceEventId is what actually makes this
      // idempotent: checking first would still leave a gap between the check
      // and the insert when the same event is delivered twice at once.
      if (isDuplicateEvent(err)) {
        this.logger.log({
          event: 'message.duplicate',
          message: 'Surplus event already recorded as an offer',
          eventId: event.eventId,
          correlationId: event.correlationId,
        });
        return false;
      }
      throw err;
    }

    this.logger.log({
      event: 'offer.created',
      message: 'Created sell offer',
      eventId: event.eventId,
      householdId: event.householdId,
      energyKwh: event.surplusKwh,
      correlationId: event.correlationId,
    });
    return true;
  }

  private async handleDemand(event: EnergyDemandDetectedEvent): Promise<boolean> {
    try {
      await this.prisma.buyRequest.create({
        data: {
          householdId: event.householdId,
          sourceEventId: event.eventId,
          requestedKwh: event.demandKwh,
          originalKwh: event.demandKwh,
          status: 'OPEN',
          correlationId: event.correlationId,
        },
      });
    } catch (err) {
      if (isDuplicateEvent(err)) {
        this.logger.log({
          event: 'message.duplicate',
          message: 'Demand event already recorded as a request',
          eventId: event.eventId,
          correlationId: event.correlationId,
        });
        return false;
      }
      throw err;
    }

    this.logger.log({
      event: 'request.created',
      message: 'Created buy request',
      eventId: event.eventId,
      householdId: event.householdId,
      energyKwh: event.demandKwh,
      correlationId: event.correlationId,
    });
    return true;
  }
}

/**
 * Returns what is wrong with the message, or null when it can be processed.
 * Anything the handler would otherwise turn into a database error is caught
 * here, where it can be told apart from a transient failure.
 */
export function validateEnergyEvent(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return 'not an object';

  const candidate = event as Partial<EnergyEvent>;
  if (!isNonEmptyString(candidate.eventId)) return 'missing eventId';
  if (normalizeCorrelationId(candidate.correlationId) === null) {
    return 'missing or unusable correlationId';
  }
  if (!isNonEmptyString(candidate.householdId)) return 'missing householdId';

  // An event from a newer producer may carry fields this consumer does not
  // understand, so it is parked rather than half-processed.
  if (candidate.version !== undefined && candidate.version > ENERGY_EVENT_VERSION) {
    return `unsupported event version ${candidate.version}`;
  }

  if (candidate.eventType === 'EnergySurplusDetected') {
    const surplus = (candidate as Partial<EnergySurplusDetectedEvent>).surplusKwh;
    return isPositiveEnergy(surplus) ? null : 'surplusKwh must be a positive decimal amount';
  }

  if (candidate.eventType === 'EnergyDemandDetected') {
    const demand = (candidate as Partial<EnergyDemandDetectedEvent>).demandKwh;
    return isPositiveEnergy(demand) ? null : 'demandKwh must be a positive decimal amount';
  }

  return `unknown eventType: ${String(candidate.eventType)}`;
}

/**
 * The library records every delivery from the moment it arrives until its
 * handler settles - guards and all - and waits on the same set when it closes
 * the connection. That wait happens alongside the database disconnect, though,
 * so it is done here first. The messaging integration tests fail if the
 * library stops keeping this set.
 */
function deliveriesInProgress(amqp: AmqpConnection): Promise<unknown>[] {
  const tracked = (amqp as unknown as { outstandingMessageProcessing?: Set<Promise<unknown>> })
    .outstandingMessageProcessing;
  return tracked ? [...tracked] : [];
}

function eventTypeOf(event: unknown): string | undefined {
  const type = (event as { eventType?: unknown } | null)?.eventType;
  return typeof type === 'string' ? type : undefined;
}

/** How many times this message has already been retried. */
export function retryCountOf(amqpMsg?: ConsumeMessage): number {
  const raw = amqpMsg?.properties?.headers?.[HEADER_RETRY_COUNT];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function originalRoutingKeyOf(amqpMsg?: ConsumeMessage): string {
  const carried = amqpMsg?.properties?.headers?.[HEADER_ORIGINAL_ROUTING_KEY];
  if (typeof carried === 'string' && carried.length > 0) return carried;
  return amqpMsg?.fields?.routingKey ?? 'unknown';
}

/**
 * The fields that identify a message in every log line about it. A malformed
 * message can carry anything, so only strings are passed on.
 */
function eventFields(event: unknown, attempt: number, maxRetries: number) {
  const candidate = (typeof event === 'object' && event !== null ? event : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    eventId: text(candidate.eventId),
    eventType: text(candidate.eventType),
    sourceEventId: text(candidate.sourceEventId),
    attempt,
    maxAttempts: maxRetries + 1,
    correlationId: normalizeCorrelationId(candidate.correlationId) ?? undefined,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Energy arrives as a decimal string. Numbers are still accepted so an older
 * producer, or a hand-crafted message, is not rejected for the wrong reason.
 */
function isPositiveEnergy(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return isDecimalWithin(value, '0.001', '1000000000');
}

function isDuplicateEvent(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
