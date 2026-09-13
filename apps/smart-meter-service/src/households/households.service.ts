import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatEnergy } from '@solar-grid/shared-utils';

@Injectable()
export class HouseholdsService {
  private readonly logger = new Logger(HouseholdsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStatus(householdId: string) {
    const status = await this.prisma.householdEnergyStatus.findUnique({
      where: { householdId },
    });
    if (!status) {
      throw new NotFoundException(`No status found for household ${householdId}`);
    }
    return {
      id: status.id,
      householdId: status.householdId,
      currentStatus: status.currentStatus,
      currentSurplusKwh: formatEnergy(status.currentSurplusKwh),
      currentDemandKwh: formatEnergy(status.currentDemandKwh),
      lastReadingAt: status.lastReadingAt.toISOString(),
      updatedAt: status.updatedAt.toISOString(),
    };
  }
}
