import { EnergyEventsConsumer } from '../src/messaging/energy-events.consumer';
import {
  EnergyDemandDetectedEvent,
  EnergyEventType,
  EnergySurplusDetectedEvent,
} from '@solar-grid/shared-contracts';

function buildMocks() {
  const mockPrisma: any = {
    sellOffer: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'offer-001' }),
    },
    buyRequest: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'request-001' }),
    },
  };

  const mockMatchingService: any = {
    runMatching: jest.fn().mockResolvedValue({ matched: 0, failed: 0, skipped: 0 }),
  };

  return {
    consumer: new EnergyEventsConsumer(mockPrisma, mockMatchingService),
    mockPrisma,
    mockMatchingService,
  };
}

const surplusEvent: EnergySurplusDetectedEvent = {
  eventId: 'evt-surplus-001',
  eventType: EnergyEventType.EnergySurplusDetected,
  correlationId: 'cid-001',
  householdId: 'HH-SELLER-001',
  productionKwh: 10,
  consumptionKwh: 3,
  surplusKwh: 7,
  timestamp: '2026-05-27T10:00:00.000Z',
};

const demandEvent: EnergyDemandDetectedEvent = {
  eventId: 'evt-demand-001',
  eventType: EnergyEventType.EnergyDemandDetected,
  correlationId: 'cid-002',
  householdId: 'HH-BUYER-001',
  productionKwh: 1,
  consumptionKwh: 5,
  demandKwh: 4,
  timestamp: '2026-05-27T10:01:00.000Z',
};

describe('EnergyEventsConsumer event idempotency', () => {
  it('creates one sell offer for a new surplus event', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.sellOffer.findUnique.mockResolvedValue(null);

    await consumer.handleEnergyEvent(surplusEvent);

    expect(mockPrisma.sellOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEventId: surplusEvent.eventId,
          householdId: surplusEvent.householdId,
          availableKwh: surplusEvent.surplusKwh,
        }),
      }),
    );
    expect(mockMatchingService.runMatching).toHaveBeenCalledWith(surplusEvent.correlationId);
  });

  it('skips duplicate surplus events', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.sellOffer.findUnique.mockResolvedValue({ id: 'offer-existing' });

    await consumer.handleEnergyEvent(surplusEvent);

    expect(mockPrisma.sellOffer.create).not.toHaveBeenCalled();
    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });

  it('creates one buy request for a new demand event', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.buyRequest.findUnique.mockResolvedValue(null);

    await consumer.handleEnergyEvent(demandEvent);

    expect(mockPrisma.buyRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEventId: demandEvent.eventId,
          householdId: demandEvent.householdId,
          requestedKwh: demandEvent.demandKwh,
        }),
      }),
    );
    expect(mockMatchingService.runMatching).toHaveBeenCalledWith(demandEvent.correlationId);
  });

  it('skips duplicate demand events', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.buyRequest.findUnique.mockResolvedValue({ id: 'request-existing' });

    await consumer.handleEnergyEvent(demandEvent);

    expect(mockPrisma.buyRequest.create).not.toHaveBeenCalled();
    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });
});
