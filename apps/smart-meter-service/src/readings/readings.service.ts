import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { CreateReadingDto } from './dto/create-reading.dto';
import { EnergyEventType } from '@solar-grid/shared-contracts';
import { generateId } from '@solar-grid/shared-utils';

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

@Injectable()
export class ReadingsService {
  private readonly logger = new Logger(ReadingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  static calculateEnergyStatus(productionKwh: number, consumptionKwh: number): EnergyCalculationResult {
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

    this.logger.log(
      `Processing reading for ${dto.householdId}: net=${netKwh} kWh, status=${status} [cid=${correlationId}]`,
    );

    const reading = await this.prisma.meterReading.create({
      data: {
        householdId: dto.householdId,
        productionKwh: dto.productionKwh,
        consumptionKwh: dto.consumptionKwh,
        netKwh,
        status,
        timestamp: new Date(dto.timestamp),
      },
    });

    await this.prisma.householdEnergyStatus.upsert({
      where: { householdId: dto.householdId },
      update: { currentStatus: status, currentSurplusKwh: surplusKwh, currentDemandKwh: demandKwh },
      create: {
        householdId: dto.householdId,
        currentStatus: status,
        currentSurplusKwh: surplusKwh,
        currentDemandKwh: demandKwh,
      },
    });

    if (status === EnergyStatus.SURPLUS) {
      await this.messaging.publishSurplusDetected({
        eventId: generateId(),
        eventType: EnergyEventType.EnergySurplusDetected,
        correlationId,
        householdId: dto.householdId,
        productionKwh: dto.productionKwh,
        consumptionKwh: dto.consumptionKwh,
        surplusKwh,
        timestamp: dto.timestamp,
      });
      this.logger.log(`Published EnergySurplusDetected for ${dto.householdId} [cid=${correlationId}]`);
    } else if (status === EnergyStatus.DEMAND) {
      await this.messaging.publishDemandDetected({
        eventId: generateId(),
        eventType: EnergyEventType.EnergyDemandDetected,
        correlationId,
        householdId: dto.householdId,
        productionKwh: dto.productionKwh,
        consumptionKwh: dto.consumptionKwh,
        demandKwh,
        timestamp: dto.timestamp,
      });
      this.logger.log(`Published EnergyDemandDetected for ${dto.householdId} [cid=${correlationId}]`);
    }

    return { ...reading, surplusKwh, demandKwh };
  }

  async getReadingsByHousehold(householdId: string) {
    return this.prisma.meterReading.findMany({
      where: { householdId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }
}
