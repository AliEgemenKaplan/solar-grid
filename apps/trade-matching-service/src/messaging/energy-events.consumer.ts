import { Injectable, Logger } from '@nestjs/common';
import { MessageHandlerErrorBehavior, Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  EnergyDemandDetectedEvent,
  EnergyEvent,
  EnergySurplusDetectedEvent,
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  QUEUE_TRADE_MATCHING_ENERGY,
  ROUTING_KEY_DEMAND_DETECTED,
  ROUTING_KEY_DLQ,
  ROUTING_KEY_SURPLUS_DETECTED,
} from '@solar-grid/shared-contracts';
import { isDecimalWithin } from '@solar-grid/shared-utils';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { Prisma } from '../../generated/client';

@Injectable()
export class EnergyEventsConsumer {
  private readonly logger = new Logger(EnergyEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
  ) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_SOLAR_GRID_ENERGY,
    routingKey: [ROUTING_KEY_SURPLUS_DETECTED, ROUTING_KEY_DEMAND_DETECTED],
    queue: QUEUE_TRADE_MATCHING_ENERGY,
    queueOptions: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_SOLAR_GRID_ENERGY_DLX,
        'x-dead-letter-routing-key': ROUTING_KEY_DLQ,
      },
    },
    // The library requeues by default, which turns one failing message into an
    // endless redelivery loop that blocks the queue. Nacking without requeue
    // sends it to the dead letter queue instead, where it can be inspected and
    // replayed. Bounded delayed retries come with the retry queue in phase 3.
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  })
  async handleEnergyEvent(event: EnergyEvent): Promise<void | Nack> {
    const problem = validateEnergyEvent(event);
    if (problem) {
      // Retrying cannot fix a malformed message, so it goes straight to the
      // dead letter queue without burning attempts on it.
      this.logger.error(`Rejecting malformed energy event (${problem}), routing to DLQ`);
      return new Nack(false);
    }

    const correlationId = event.correlationId;
    this.logger.log(
      `Received event: ${event.eventType} eventId=${event.eventId} household=${event.householdId} [cid=${correlationId}]`,
    );

    try {
      const created =
        event.eventType === 'EnergySurplusDetected'
          ? await this.handleSurplus(event)
          : await this.handleDemand(event);

      if (created) {
        await this.matchingService.runMatching(correlationId);
      }
    } catch (err) {
      const reason = describe(err);
      this.logger.error(
        `Failed to process ${event.eventType} for ${event.householdId}: ${reason} [cid=${correlationId}]`,
      );
      // Nacked without requeue by errorBehavior above, so the message lands in
      // the dead letter queue rather than being redelivered forever.
      throw err;
    }
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
  if (!isNonEmptyString(candidate.correlationId)) return 'missing correlationId';
  if (!isNonEmptyString(candidate.householdId)) return 'missing householdId';

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
