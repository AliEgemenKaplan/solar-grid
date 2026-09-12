import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxPublisherService } from '../messaging/outbox-publisher.service';
import { CreateReadingDto } from './dto/create-reading.dto';
import {
  EnergyDemandDetectedEvent,
  EnergyEventType,
  EnergySurplusDetectedEvent,
  ROUTING_KEY_DEMAND_DETECTED,
  ROUTING_KEY_SURPLUS_DETECTED,
} from '@solar-grid/shared-contracts';
import { generateId } from '@solar-grid/shared-utils';
import { Prisma } from '../../generated/client';

export enum EnergyStatus {
  SURPLUS = 'SURPLUS',
  DEMAND = 'DEMAND',
  BALANCED = 'BALANCED',
}

export interface EnergyCalculationResult {
  status: EnergyStatus;
  netKwh: number;
  surplusKwh: number;
  demandKwh: number;
}

interface OutboxRecord {
  eventId: string;
  eventType: string;
  routingKey: string;
  payload: EnergySurplusDetectedEvent | EnergyDemandDetectedEvent;
  correlationId: string;
}

@Injectable()
export class ReadingsService {
  private readonly logger = new Logger(ReadingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisherService,
  ) {}

  static calculateEnergyStatus(
    productionKwh: number,
    consumptionKwh: number,
  ): EnergyCalculationResult {
    const netKwh = productionKwh - consumptionKwh;
    if (netKwh > 0) {
      return { status: EnergyStatus.SURPLUS, netKwh, surplusKwh: netKwh, demandKwh: 0 };
    }
    if (netKwh < 0) {
      return { status: EnergyStatus.DEMAND, netKwh, surplusKwh: 0, demandKwh: Math.abs(netKwh) };
    }
    return { status: EnergyStatus.BALANCED, netKwh: 0, surplusKwh: 0, demandKwh: 0 };
  }

  async createReading(dto: CreateReadingDto, correlationId: string) {
    const { status, netKwh, surplusKwh, demandKwh } = ReadingsService.calculateEnergyStatus(
      dto.productionKwh,
      dto.consumptionKwh,
    );
    const timestamp = new Date(dto.timestamp);

    // A meter reports one reading per household per timestamp, so a client
    // retry must not produce a second reading or a second event.
    const existing = await this.prisma.meterReading.findUnique({
      where: { householdId_timestamp: { householdId: dto.householdId, timestamp } },
    });
    if (existing) {
      this.logger.warn(
        `Duplicate reading ignored: household=${dto.householdId} timestamp=${dto.timestamp} [cid=${correlationId}]`,
      );
      return { ...existing, surplusKwh, demandKwh, duplicate: true };
    }

    this.logger.log(
      `Processing reading for ${dto.householdId}: net=${netKwh} kWh, status=${status} [cid=${correlationId}]`,
    );

    const outboxRecord = this.buildEvent(dto, status, surplusKwh, demandKwh, correlationId);

    try {
      const reading = await this.prisma.$transaction(async (tx) => {
        const created = await tx.meterReading.create({
          data: {
            householdId: dto.householdId,
            productionKwh: dto.productionKwh,
            consumptionKwh: dto.consumptionKwh,
            netKwh,
            status,
            timestamp,
          },
        });

        await tx.householdEnergyStatus.upsert({
          where: { householdId: dto.householdId },
          update: {
            currentStatus: status,
            currentSurplusKwh: surplusKwh,
            currentDemandKwh: demandKwh,
          },
          create: {
            householdId: dto.householdId,
            currentStatus: status,
            currentSurplusKwh: surplusKwh,
            currentDemandKwh: demandKwh,
          },
        });

        // Same transaction as the reading: either both exist or neither does.
        if (outboxRecord) {
          await tx.outboxEvent.create({
            data: {
              eventId: outboxRecord.eventId,
              eventType: outboxRecord.eventType,
              routingKey: outboxRecord.routingKey,
              payload: outboxRecord.payload as unknown as Prisma.InputJsonValue,
              correlationId: outboxRecord.correlationId,
            },
          });
        }

        return created;
      });

      if (outboxRecord) {
        this.logger.log(
          `Queued ${outboxRecord.eventType} for ${dto.householdId}: eventId=${outboxRecord.eventId} [cid=${correlationId}]`,
        );
        // Publish now rather than waiting for the next poll. The poller is the
        // backstop if this fails, so the result is deliberately not awaited.
        void this.outbox.drain().catch(() => undefined);
      }

      return { ...reading, surplusKwh, demandKwh, duplicate: false };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Two concurrent retries of the same reading; the other one won.
        const winner = await this.prisma.meterReading.findUnique({
          where: { householdId_timestamp: { householdId: dto.householdId, timestamp } },
        });
        if (winner) {
          this.logger.warn(
            `Concurrent duplicate reading ignored: household=${dto.householdId} timestamp=${dto.timestamp} [cid=${correlationId}]`,
          );
          return { ...winner, surplusKwh, demandKwh, duplicate: true };
        }
      }
      throw err;
    }
  }

  async getReadingsByHousehold(householdId: string) {
    return this.prisma.meterReading.findMany({
      where: { householdId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }

  private buildEvent(
    dto: CreateReadingDto,
    status: EnergyStatus,
    surplusKwh: number,
    demandKwh: number,
    correlationId: string,
  ): OutboxRecord | null {
    const eventId = generateId();
    const common = {
      eventId,
      correlationId,
      householdId: dto.householdId,
      productionKwh: dto.productionKwh,
      consumptionKwh: dto.consumptionKwh,
      timestamp: dto.timestamp,
    };

    if (status === EnergyStatus.SURPLUS) {
      const payload: EnergySurplusDetectedEvent = {
        ...common,
        eventType: EnergyEventType.EnergySurplusDetected,
        surplusKwh,
      };
      return {
        eventId,
        eventType: EnergyEventType.EnergySurplusDetected,
        routingKey: ROUTING_KEY_SURPLUS_DETECTED,
        payload,
        correlationId,
      };
    }

    if (status === EnergyStatus.DEMAND) {
      const payload: EnergyDemandDetectedEvent = {
        ...common,
        eventType: EnergyEventType.EnergyDemandDetected,
        demandKwh,
      };
      return {
        eventId,
        eventType: EnergyEventType.EnergyDemandDetected,
        routingKey: ROUTING_KEY_DEMAND_DETECTED,
        payload,
        correlationId,
      };
    }

    // A balanced reading has nothing to trade.
    return null;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
