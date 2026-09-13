import type { ConsumeMessage } from 'amqplib';
import {
  ENERGY_EVENT_VERSION,
  EnergyDemandDetectedEvent,
  EnergyEventType,
  EnergySurplusDetectedEvent,
  EXCHANGE_SOLAR_GRID_ENERGY_DLX,
  EXCHANGE_SOLAR_GRID_ENERGY_RETRY,
  HEADER_FAILURE_REASON,
  HEADER_RETRY_COUNT,
  ROUTING_KEY_DLQ,
  ROUTING_KEY_SURPLUS_DETECTED,
} from '@solar-grid/shared-contracts';
import {
  EnergyEventsConsumer,
  retryCountOf,
  validateEnergyEvent,
} from '../src/messaging/energy-events.consumer';
import { Prisma } from '../generated/client';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const MAX_RETRIES = 3;

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

  const publish = jest.fn().mockResolvedValue(true);
  const mockAmqp: any = { publish };

  const config: any = {
    get: (key: string, fallback: string) =>
      key === 'RABBITMQ_MAX_RETRIES' ? String(MAX_RETRIES) : fallback,
  };

  return {
    consumer: new EnergyEventsConsumer(mockPrisma, mockMatchingService, mockAmqp, config),
    mockPrisma,
    mockMatchingService,
    publish,
  };
}

/** A delivery carrying however many retries have already happened. */
function delivery(retryCount = 0, routingKey = ROUTING_KEY_SURPLUS_DETECTED): ConsumeMessage {
  return {
    fields: { routingKey, deliveryTag: 1, redelivered: false, exchange: 'solar-grid.energy' },
    properties: { headers: retryCount ? { [HEADER_RETRY_COUNT]: retryCount } : {} },
    content: Buffer.from(''),
  } as unknown as ConsumeMessage;
}

const surplusEvent: EnergySurplusDetectedEvent = {
  eventId: 'evt-surplus-001',
  eventType: EnergyEventType.EnergySurplusDetected,
  version: ENERGY_EVENT_VERSION,
  occurredAt: '2026-05-27T10:00:01.000Z',
  correlationId: 'cid-001',
  sourceEventId: 'reading-001',
  householdId: 'HH-SELLER-001',
  productionKwh: '10.000',
  consumptionKwh: '3.000',
  surplusKwh: '7.000',
  timestamp: '2026-05-27T10:00:00.000Z',
};

const demandEvent: EnergyDemandDetectedEvent = {
  eventId: 'evt-demand-001',
  eventType: EnergyEventType.EnergyDemandDetected,
  version: ENERGY_EVENT_VERSION,
  occurredAt: '2026-05-27T10:01:01.000Z',
  correlationId: 'cid-002',
  sourceEventId: 'reading-002',
  householdId: 'HH-BUYER-001',
  productionKwh: '1.000',
  consumptionKwh: '5.000',
  demandKwh: '4.000',
  timestamp: '2026-05-27T10:01:00.000Z',
};

describe('EnergyEventsConsumer', () => {
  it('creates a sell offer for a new surplus event and runs matching', async () => {
    const { consumer, mockPrisma, mockMatchingService, publish } = buildMocks();

    await consumer.handleEnergyEvent(surplusEvent, delivery());

    expect(mockPrisma.sellOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEventId: surplusEvent.eventId,
          availableKwh: surplusEvent.surplusKwh,
        }),
      }),
    );
    expect(mockMatchingService.runMatching).toHaveBeenCalledWith(surplusEvent.correlationId);
    // Nothing republished: a message that succeeded is simply acknowledged.
    expect(publish).not.toHaveBeenCalled();
  });

  it('creates a buy request for a new demand event and runs matching', async () => {
    const { consumer, mockPrisma, mockMatchingService } = buildMocks();

    await consumer.handleEnergyEvent(demandEvent, delivery());

    expect(mockPrisma.buyRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestedKwh: demandEvent.demandKwh }),
      }),
    );
    expect(mockMatchingService.runMatching).toHaveBeenCalledWith(demandEvent.correlationId);
  });

  it('treats a redelivered event as already handled', async () => {
    const { consumer, mockPrisma, mockMatchingService, publish } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(uniqueViolation());

    await consumer.handleEnergyEvent(surplusEvent, delivery());

    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('schedules a delayed retry when the first attempt fails', async () => {
    const { consumer, mockPrisma, publish } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(new Error('database is not available'));

    await consumer.handleEnergyEvent(surplusEvent, delivery());

    expect(publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, body, options] = publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGE_SOLAR_GRID_ENERGY_RETRY);
    expect(routingKey).toBe('retry.1');
    expect(body).toEqual(surplusEvent);
    expect(options.persistent).toBe(true);
    expect(options.headers[HEADER_RETRY_COUNT]).toBe(1);
    expect(options.headers[HEADER_FAILURE_REASON]).toContain('database is not available');
  });

  it('moves through the retry tiers as attempts accumulate', async () => {
    const { consumer, mockPrisma, publish } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(new Error('still broken'));

    await consumer.handleEnergyEvent(surplusEvent, delivery(1));
    await consumer.handleEnergyEvent(surplusEvent, delivery(2));

    expect(publish.mock.calls.map((call) => call[1])).toEqual(['retry.2', 'retry.3']);
  });

  it('parks the message once the retries are used up', async () => {
    const { consumer, mockPrisma, publish } = buildMocks();
    mockPrisma.sellOffer.create.mockRejectedValue(new Error('still broken'));

    // Three retries have already happened, so this delivery is the last one.
    await consumer.handleEnergyEvent(surplusEvent, delivery(MAX_RETRIES));

    expect(publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, , options] = publish.mock.calls[0];
    expect(exchange).toBe(EXCHANGE_SOLAR_GRID_ENERGY_DLX);
    expect(routingKey).toBe(ROUTING_KEY_DLQ);
    expect(options.headers[HEADER_RETRY_COUNT]).toBe(MAX_RETRIES);
    expect(options.headers[HEADER_FAILURE_REASON]).toContain('still broken');
  });

  it('never retries a malformed event, and never touches the database for it', async () => {
    const { consumer, mockPrisma, mockMatchingService, publish } = buildMocks();

    await consumer.handleEnergyEvent(
      { ...surplusEvent, surplusKwh: undefined } as unknown as EnergySurplusDetectedEvent,
      delivery(),
    );

    expect(mockPrisma.sellOffer.create).not.toHaveBeenCalled();
    expect(mockMatchingService.runMatching).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe(EXCHANGE_SOLAR_GRID_ENERGY_DLX);
    expect(publish.mock.calls[0][3].headers[HEADER_FAILURE_REASON]).toContain('unprocessable');
  });
});

describe('retryCountOf', () => {
  it('reads the retry header, defaulting to zero', () => {
    expect(retryCountOf(delivery())).toBe(0);
    expect(retryCountOf(delivery(2))).toBe(2);
    expect(retryCountOf(undefined)).toBe(0);
  });
});

describe('validateEnergyEvent', () => {
  it('accepts well formed events', () => {
    expect(validateEnergyEvent(surplusEvent)).toBeNull();
    expect(validateEnergyEvent(demandEvent)).toBeNull();
  });

  it('accepts an event without the newer envelope fields', () => {
    const { version, occurredAt, sourceEventId, ...older } = surplusEvent;
    expect(validateEnergyEvent(older)).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['missing eventId', { ...surplusEvent, eventId: '' }],
    ['missing correlationId', { ...surplusEvent, correlationId: '  ' }],
    [
      'a correlationId that does not belong in a log line',
      {
        ...surplusEvent,
        correlationId: 'a'.repeat(200),
      },
    ],
    ['missing householdId', { ...surplusEvent, householdId: undefined }],
    ['unknown eventType', { ...surplusEvent, eventType: 'SomethingElse' }],
    ['an event version this consumer does not understand', { ...surplusEvent, version: 99 }],
    ['negative surplus', { ...surplusEvent, surplusKwh: '-5.000' }],
    ['zero surplus', { ...surplusEvent, surplusKwh: '0.000' }],
    ['non numeric demand', { ...demandEvent, demandKwh: 'lots' }],
    ['infinite demand', { ...demandEvent, demandKwh: Number.POSITIVE_INFINITY }],
  ])('rejects %s', (_label, event) => {
    expect(validateEnergyEvent(event)).not.toBeNull();
  });
});
