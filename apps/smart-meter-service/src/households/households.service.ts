import { Injectable } from '@nestjs/common';
import { formatEnergy } from '@solar-grid/shared-utils';
import { Page, pageWindow, ResourceNotFoundException, toPage } from '@solar-grid/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { HouseholdListQuery, HouseholdStatusResponse } from '../readings/dto/create-reading.dto';
import { HouseholdEnergyStatus } from '../../generated/client';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every household that has reported at least once, most recently active
   * first. One row per household, so the table stays small and the count is
   * cheap.
   */
  async listHouseholds(query: HouseholdListQuery): Promise<Page<HouseholdStatusResponse>> {
    const where = query.status ? { currentStatus: query.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.householdEnergyStatus.findMany({
        where,
        orderBy: [{ lastReadingAt: 'desc' }, { householdId: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.householdEnergyStatus.count({ where }),
    ]);
    return toPage(rows.map(toStatusResponse), total, query);
  }

  async getStatus(householdId: string): Promise<HouseholdStatusResponse> {
    const status = await this.prisma.householdEnergyStatus.findUnique({ where: { householdId } });
    if (!status) {
      throw new ResourceNotFoundException(
        `Household ${householdId} has not reported any readings.`,
      );
    }
    return toStatusResponse(status);
  }
}

function toStatusResponse(status: HouseholdEnergyStatus): HouseholdStatusResponse {
  return {
    householdId: status.householdId,
    currentStatus: status.currentStatus,
    currentSurplusKwh: formatEnergy(status.currentSurplusKwh),
    currentDemandKwh: formatEnergy(status.currentDemandKwh),
    lastReadingAt: status.lastReadingAt.toISOString(),
    updatedAt: status.updatedAt.toISOString(),
  };
}
