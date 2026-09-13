import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
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
import { DecimalLike, formatEnergy, generateId } from '@solar-grid/shared-utils';
import { MeterReading, Prisma } from '../../generated/client';

export enum EnergyStatus {
  SURPLUS = 'SURPLUS',
  DEMAND = 'DEMAND',
  BALANCED = 'BALANCED',
}

export interface EnergyCalculationResult {
  status: EnergyStatus;
  /** kWh as fixed-scale decimal strings, never floats. */
  netKwh: string;
  surplusKwh: string;
  demandKwh: string;
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

  /**
   * Decides what a reading means. Exact decimal arithmetic, so a household
   * that produces 0.3 and consumes 0.1 has a surplus of exactly 0.200 kWh
   * rather than 0.19999999999999998.
   */
  static calculateEnergyStatus(
    productionKwh: DecimalLike,
    consumptionKwh: DecimalLike,
  ): EnergyCalculationResult {
    const net = new Decimal(String(productionKwh)).minus(String(consumptionKwh));

    if (net.isPositive() && !net.isZero()) {
      return {
        status: EnergyStatus.SURPLUS,
        netKwh: formatEnergy(net),
        surplusKwh: formatEnergy(net),
        demandKwh: formatEnergy(0),
      };
    }

    if (net.isNegative()) {
      return {
        status: EnergyStatus.DEMAND,
        netKwh: formatEnergy(net),
        surplusKwh: formatEnergy(0),
        demandKwh: formatEnergy(net.abs()),
      };
    }

    return {
      status: EnergyStatus.BALANCED,
      netKwh: formatEnergy(0),
      surplusKwh: formatEnergy(0),
      demandKwh: formatEnergy(0),
    };
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
      return toReadingResponse(existing, surplusKwh, demandKwh, true);
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
            productionKwh: formatEnergy(dto.productionKwh),
            consumptionKwh: formatEnergy(dto.consumptionKwh),
            netKwh,
            status,
            timestamp,
          },
        });

        await this.applyHouseholdStatus(
          tx,
          dto.householdId,
          status,
          surplusKwh,
          demandKwh,
          timestamp,
        );

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

      return toReadingResponse(reading, surplusKwh, demandKwh, false);
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
          return toReadingResponse(winner, surplusKwh, demandKwh, true);
        }
      }
      throw err;
    }
  }

  async getReadingsByHousehold(householdId: string) {
    const readings = await this.prisma.meterReading.findMany({
      where: { householdId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
    return readings.map((reading) => toReadingSummary(reading));
  }

  /**
   * Writes the household's current status, but never lets an older reading
   * overwrite a newer one. Expressed as a conditional upsert so two readings
   * arriving at once cannot interleave into the wrong order.
   */
  private applyHouseholdStatus(
    tx: Prisma.TransactionClient,
    householdId: string,
    status: EnergyStatus,
    surplusKwh: string,
    demandKwh: string,
    timestamp: Date,
  ) {
    return tx.$executeRaw`
      INSERT INTO "household_energy_status"
        ("id", "householdId", "currentStatus", "currentSurplusKwh", "currentDemandKwh", "lastReadingAt", "updatedAt")
      VALUES
        (${randomUUID()}, ${householdId}, ${status}::"EnergyStatus", ${surplusKwh}::decimal, ${demandKwh}::decimal, ${timestamp}, now())
      ON CONFLICT ("householdId") DO UPDATE SET
        "currentStatus" = EXCLUDED."currentStatus",
        "currentSurplusKwh" = EXCLUDED."currentSurplusKwh",
        "currentDemandKwh" = EXCLUDED."currentDemandKwh",
        "lastReadingAt" = EXCLUDED."lastReadingAt",
        "updatedAt" = now()
      WHERE "household_energy_status"."lastReadingAt" < EXCLUDED."lastReadingAt"
    `;
  }

  private buildEvent(
    dto: CreateReadingDto,
    status: EnergyStatus,
    surplusKwh: string,
    demandKwh: string,
    correlationId: string,
  ): OutboxRecord | null {
    const eventId = generateId();
    const common = {
      eventId,
      correlationId,
      householdId: dto.householdId,
      productionKwh: formatEnergy(dto.productionKwh),
      consumptionKwh: formatEnergy(dto.consumptionKwh),
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

/** Energy leaves this service as fixed-scale decimal strings. */
function toReadingSummary(reading: MeterReading) {
  return {
    id: reading.id,
    householdId: reading.householdId,
    productionKwh: formatEnergy(reading.productionKwh),
    consumptionKwh: formatEnergy(reading.consumptionKwh),
    netKwh: formatEnergy(reading.netKwh),
    status: reading.status,
    timestamp: reading.timestamp.toISOString(),
    createdAt: reading.createdAt.toISOString(),
  };
}

function toReadingResponse(
  reading: MeterReading,
  surplusKwh: string,
  demandKwh: string,
  duplicate: boolean,
) {
  return {
    ...toReadingSummary(reading),
    surplusKwh: formatEnergy(surplusKwh),
    demandKwh: formatEnergy(demandKwh),
    duplicate,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
