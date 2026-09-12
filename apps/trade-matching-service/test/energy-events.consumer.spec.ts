import { Nack } from '@golevelup/nestjs-rabbitmq';
import {
  EnergyDemandDetectedEvent,
  EnergyEventType,
  EnergySurplusDetectedEvent,
} from '@solar-grid/shared-contracts';
import { EnergyEventsConsumer, validateEnergyEvent } from '../src/messaging/energy-events.consumer';
import { Prisma } from '../generated/client';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

function buildMocks() {
  const mockPrisma: any = {
    sellOffer: { create: jest.fn().mockResolvedValue({ id: 'offer-001' }) },
    buyRequest: { create: jest.fn().mockResolvedValue({ id: 'request-001' }) },
  };

  const mockMatchingService: any = {
    runMatching: jest
      .fn()
      .mockResolvedValue({ matched: 0, failed: 0, skipped: 0, pending: 0, settled: 0 }),
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

describe('EnergyEventsConsumer', () => {
  it('creates a sell offer for a new surplus event and runs matching', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();

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

  it('creates a buy request for a new demand event and runs matching', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();

    await consumer.handleEnergyEvent(demandEvent);

    expect(mockPrisma.buyRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEventId: demandEvent.eventId,
          requestedKwh: demandEvent.demandKwh,
        }),
      }),
    );
    expect(mockMatchingService.runMatching).toHaveBeenCalledWith(demandEvent.correlationId);
  });

  it('treats a redelivered surplus event as already handled', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(uniqueViolation());

    await expect(consumer.handleEnergyEvent(surplusEvent)).resolves.toBeUndefined();

    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });

  it('treats a redelivered demand event as already handled', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.buyRequest.create.mockRejectedValue(uniqueViolation());

    await expect(consumer.handleEnergyEvent(demandEvent)).resolves.toBeUndefined();

    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });

  it('rethrows a genuine database failure so the message is dead lettered', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(new Error('connection terminated'));

    await expect(consumer.handleEnergyEvent(surplusEvent)).rejects.toThrow('connection terminated');

    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });

  it('rejects a malformed event without touching the database', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();

    const result = await consumer.handleEnergyEvent({
      ...surplusEvent,
      surplusKwh: undefined,
    } as unknown as EnergySurplusDetectedEvent);

    expect(result).toBeInstanceOf(Nack);
    expect((result as Nack).requeue).toBe(false);
    expect(mockPrisma.sellOffer.create).not.toHaveBeenCalled();
    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
  });
});

describe('validateEnergyEvent', () => {
  it('accepts well formed events', () => {
    expect(validateEnergyEvent(surplusEvent)).toBeNull();
    expect(validateEnergyEvent(demandEvent)).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['missing eventId', { ...surplusEvent, eventId: '' }],
    ['missing correlationId', { ...surplusEvent, correlationId: '  ' }],
    ['missing householdId', { ...surplusEvent, householdId: undefined }],
    ['unknown eventType', { ...surplusEvent, eventType: 'SomethingElse' }],
    ['negative surplus', { ...surplusEvent, surplusKwh: -5 }],
    ['non numeric demand', { ...demandEvent, demandKwh: 'lots' }],
    ['infinite demand', { ...demandEvent, demandKwh: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, event) => {
    expect(validateEnergyEvent(event)).not.toBeNull();
  });
});
