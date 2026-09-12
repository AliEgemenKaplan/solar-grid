import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  EnergySurplusDetectedEvent,
  EnergyDemandDetectedEvent,
  EXCHANGE_SOLAR_GRID_ENERGY,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  ROUTING_KEY_SURPLUS_DETECTED,
  ROUTING_KEY_DEMAND_DETECTED,
  QUEUE_TRADE_MATCHING_ENERGY,
} from '@solar-grid/shared-contracts';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';

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
        'x-dead-letter-routing-key': 'dlq.energy',
      },
    },
  })
  async handleEnergyEvent(event: EnergySurplusDetectedEvent | EnergyDemandDetectedEvent) {
    const correlationId = event.correlationId;
    this.logger.log(
      `Received event: ${event.eventType} eventId=${event.eventId} household=${event.householdId} [cid=${correlationId}]`,
    );

    try {
      let created = false;
      if (event.eventType === 'EnergySurplusDetected') {
        created = await this.handleSurplus(event as EnergySurplusDetectedEvent);
      } else if (event.eventType === 'EnergyDemandDetected') {
        created = await this.handleDemand(event as EnergyDemandDetectedEvent);
      }

      if (created) {
        await this.matchingService.runMatching(correlationId);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to process ${event.eventType} for ${event.householdId}: ${reason} [cid=${correlationId}]`,
      );
      // Re-throw to trigger NACK → dead letter queue after retries
      throw err;
    }
  }

  private async handleSurplus(event: EnergySurplusDetectedEvent): Promise<boolean> {
    const existing = await this.prisma.sellOffer.findUnique({
      where: { sourceEventId: event.eventId },
    });

    if (existing) {
      this.logger.warn(
        `Duplicate surplus event skipped: eventId=${event.eventId} offerId=${existing.id} [cid=${event.correlationId}]`,
      );
      return false;
    }

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
    this.logger.log(
      `Created sell offer: eventId=${event.eventId} household=${event.householdId} kwh=${event.surplusKwh} [cid=${event.correlationId}]`,
    );
    return true;
  }

  private async handleDemand(event: EnergyDemandDetectedEvent): Promise<boolean> {
    const existing = await this.prisma.buyRequest.findUnique({
      where: { sourceEventId: event.eventId },
    });

    if (existing) {
      this.logger.warn(
        `Duplicate demand event skipped: eventId=${event.eventId} requestId=${existing.id} [cid=${event.correlationId}]`,
      );
      return false;
    }

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
    this.logger.log(
      `Created buy request: eventId=${event.eventId} household=${event.householdId} kwh=${event.demandKwh} [cid=${event.correlationId}]`,
    );
    return true;
  }
}
