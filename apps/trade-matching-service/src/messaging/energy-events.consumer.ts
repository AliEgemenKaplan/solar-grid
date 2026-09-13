import { Injectable, Logger } from '@nestjs/common';
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
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { readRetryConfig, retryDelayMs, RetryConfig } from './retry.config';
import { Prisma } from '../../generated/client';

@Injectable()
export class EnergyEventsConsumer {
  private readonly logger = new Logger(EnergyEventsConsumer.name);
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    this.retryConfig = readRetryConfig(config);
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
  async handleEnergyEvent(event: EnergyEvent, amqpMsg: ConsumeMessage): Promise<void> {
    const attempt = retryCountOf(amqpMsg) + 1;
    const context = describeEvent(event, attempt, this.retryConfig.maxRetries);

    const problem = validateEnergyEvent(event);
    if (problem) {
      // No number of retries turns a malformed message into a valid one.
      this.logger.error(`Unprocessable energy event (${problem}) ${context}`);
      await this.parkInDeadLetterQueue(event, amqpMsg, `unprocessable: ${problem}`, attempt);
      return;
    }

    this.logger.log(`Received ${event.eventType} ${context}`);

    try {
      const created =
        event.eventType === 'EnergySurplusDetected'
          ? await this.handleSurplus(event)
          : await this.handleDemand(event);

      if (created) {
        await this.matchingService.runMatching(event.correlationId);
      }
    } catch (err) {
      const reason = describe(err);

      if (attempt > this.retryConfig.maxRetries) {
        this.logger.error(`Giving up on ${event.eventType}: ${reason} ${context}`);
        await this.parkInDeadLetterQueue(event, amqpMsg, reason, attempt);
        return;
      }

      this.logger.warn(`Retrying ${event.eventType} after failure: ${reason} ${context}`);
      await this.scheduleRetry(event, amqpMsg, reason, attempt);
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

    this.logger.log(
      `Scheduled retry ${attempt}/${this.retryConfig.maxRetries} in ${retryDelayMs(attempt, this.retryConfig.baseDelayMs)}ms: eventId=${event.eventId} [cid=${event.correlationId}]`,
    );
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

    this.logger.error(
      `Parked in the dead letter queue after ${attempt - 1} retries: eventId=${String(event?.eventId)} reason=${reason}`,
    );
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
        this.logger.warn(
          `Duplicate surplus event skipped: eventId=${event.eventId} [cid=${event.correlationId}]`,
        );
        return false;
      }
      throw err;
    }

    this.logger.log(
      `Created sell offer: eventId=${event.eventId} household=${event.householdId} kwh=${event.surplusKwh} [cid=${event.correlationId}]`,
    );
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
        this.logger.warn(
          `Duplicate demand event skipped: eventId=${event.eventId} [cid=${event.correlationId}]`,
        );
        return false;
      }
      throw err;
    }

    this.logger.log(
      `Created buy request: eventId=${event.eventId} household=${event.householdId} kwh=${event.demandKwh} [cid=${event.correlationId}]`,
    );
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

/** One log-friendly string with everything needed to trace a message. */
function describeEvent(event: EnergyEvent, attempt: number, maxRetries: number): string {
  return `eventId=${String(event?.eventId)} type=${String(event?.eventType)} sourceEventId=${String(event?.sourceEventId ?? '-')} attempt=${attempt}/${maxRetries + 1} [cid=${String(event?.correlationId)}]`;
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
