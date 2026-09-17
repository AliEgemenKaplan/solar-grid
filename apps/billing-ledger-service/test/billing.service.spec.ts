import {
  BusinessRuleViolationException,
  IdempotencyConflictException,
  MetricsRegistry,
} from '@solar-grid/nest-common';
import { LedgerMetrics } from '../src/metrics/ledger.metrics';
import { TradesService } from '../src/trades/trades.service';
import { CreateTradeDto } from '../src/trades/dto/create-trade.dto';
import { expectedTotal, tradeRequestFingerprint } from '../src/trades/request-fingerprint';

const mockIdempotencyKey = { findUnique: jest.fn(), create: jest.fn() };
const mockCompletedTrade = { create: jest.fn(), findUnique: jest.fn() };
const mockLedgerEntry = { createMany: jest.fn() };
const mockHouseholdBalance = { upsert: jest.fn() };

const mockPrisma: any = {
  idempotencyKey: mockIdempotencyKey,
  completedTrade: mockCompletedTrade,
  ledgerEntry: mockLedgerEntry,
  householdBalance: mockHouseholdBalance,
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};

const buildTradeDto = (overrides: Partial<CreateTradeDto> = {}): CreateTradeDto => ({
  tradeId: 'TRD-001',
  sellerHouseholdId: 'HH-SELLER-001',
  buyerHouseholdId: 'HH-BUYER-001',
  energyKwh: '4.000',
  pricePerKwh: '4.7500',
  totalAmount: '19.00',
  currency: 'TRY',
  idempotencyKey: 'TRD-001',
  correlationId: 'corr-001',
  completedAt: '2026-05-27T10:10:00.000Z',
  ...overrides,
});

const storedTrade = {
  id: 'rec-001',
  tradeId: 'TRD-001',
  sellerHouseholdId: 'HH-SELLER-001',
  buyerHouseholdId: 'HH-BUYER-001',
  energyKwh: '4.000',
  pricePerKwh: '4.7500',
  totalAmount: '19.00',
  currency: 'TRY',
  idempotencyKey: 'TRD-001',
  correlationId: 'corr-001',
  completedAt: new Date('2026-05-27T10:10:00.000Z'),
  createdAt: new Date('2026-05-27T10:10:01.000Z'),
};

function givenNewKey() {
  mockIdempotencyKey.findUnique.mockResolvedValue(null);
  mockCompletedTrade.create.mockResolvedValue(storedTrade);
  mockIdempotencyKey.create.mockResolvedValue({});
  mockLedgerEntry.createMany.mockResolvedValue({ count: 2 });
  mockHouseholdBalance.upsert.mockResolvedValue({});
}

function givenRecordedKey(requestHash: string | null) {
  mockIdempotencyKey.findUnique.mockResolvedValue({
    key: 'TRD-001',
    tradeId: 'TRD-001',
    requestHash,
    trade: storedTrade,
  });
}

function expectNothingWritten() {
  expect(mockCompletedTrade.create).not.toHaveBeenCalled();
  expect(mockLedgerEntry.createMany).not.toHaveBeenCalled();
  expect(mockHouseholdBalance.upsert).not.toHaveBeenCalled();
}

describe('TradesService - idempotency', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
  });

  it('records the trade, both ledger entries and both balances on the first call', async () => {
    givenNewKey();

    const result = await service.createTrade(buildTradeDto());

    expect(result.created).toBe(true);
    expect(result.trade.duplicate).toBe(false);
    expect(mockCompletedTrade.create).toHaveBeenCalledTimes(1);
    expect(mockLedgerEntry.createMany).toHaveBeenCalledTimes(1);
    expect(mockHouseholdBalance.upsert).toHaveBeenCalledTimes(2);
  });

  it('stores the request fingerprint alongside the key', async () => {
    givenNewKey();
    const dto = buildTradeDto();

    await service.createTrade(dto);

    expect(mockIdempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestHash: tradeRequestFingerprint(dto) }),
    });
  });

  it('answers a replay of the same request with the stored trade and writes nothing', async () => {
    givenRecordedKey(tradeRequestFingerprint(buildTradeDto()));

    const result = await service.createTrade(buildTradeDto());

    expect(result.created).toBe(false);
    expect(result.trade.duplicate).toBe(true);
    expectNothingWritten();
  });

  it('refuses the same key with a different payload', async () => {
    givenRecordedKey(tradeRequestFingerprint(buildTradeDto()));

    const different = buildTradeDto({ energyKwh: '5.000', totalAmount: '23.75' });

    await expect(service.createTrade(different)).rejects.toBeInstanceOf(
      IdempotencyConflictException,
    );
    expectNothingWritten();
  });

  it('names the fields that differ in the conflict', async () => {
    givenRecordedKey(tradeRequestFingerprint(buildTradeDto()));

    const error = await service
      .createTrade(buildTradeDto({ buyerHouseholdId: 'HH-SOMEONE-ELSE' }))
      .catch((err: IdempotencyConflictException) => err);

    expect(error).toBeInstanceOf(IdempotencyConflictException);
    expect(JSON.stringify((error as IdempotencyConflictException).getResponse())).toContain(
      'buyerHouseholdId',
    );
  });

  it('treats a key recorded before hashing existed as a replay, not a conflict', async () => {
    givenRecordedKey(null);

    const result = await service.createTrade(buildTradeDto());

    expect(result.trade.duplicate).toBe(true);
    expectNothingWritten();
  });
});

describe('TradesService - business rules', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
  });

  it('refuses a trade where a household is both sides', async () => {
    await expect(
      service.createTrade(buildTradeDto({ buyerHouseholdId: 'HH-SELLER-001' })),
    ).rejects.toBeInstanceOf(BusinessRuleViolationException);

    expect(mockIdempotencyKey.findUnique).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it('refuses a total that is not the energy times the price', async () => {
    // 4 kWh at 4.75 is 19.00, not 1.00.
    await expect(
      service.createTrade(buildTradeDto({ totalAmount: '1.00' })),
    ).rejects.toBeInstanceOf(BusinessRuleViolationException);

    expectNothingWritten();
  });

  it('recomputes the total with exact rounding', () => {
    expect(expectedTotal('4.000', '4.7500')).toBe('19.00');
    expect(expectedTotal('0.333', '3.0000')).toBe('1.00');
    // 1.005 rounds half up, where a double would round it down to 1.00.
    expect(expectedTotal('1.005', '1.0000')).toBe('1.01');
  });
});

describe('TradesService - money movement', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
    givenNewKey();
  });

  it('credits the seller and debits the buyer by the same amount', async () => {
    await service.createTrade(
      buildTradeDto({ sellerHouseholdId: 'HH-S', buyerHouseholdId: 'HH-B' }),
    );

    const calls = mockHouseholdBalance.upsert.mock.calls.map((call) => call[0]);
    const seller = calls.find((call) => call.where.householdId === 'HH-S');
    const buyer = calls.find((call) => call.where.householdId === 'HH-B');

    expect(seller.update.balance.increment).toBe('19.00');
    expect(buyer.update.balance.increment).toBe('-19.00');
  });

  it('writes one CREDIT for the seller and one DEBIT for the buyer', async () => {
    await service.createTrade(
      buildTradeDto({ sellerHouseholdId: 'HH-S', buyerHouseholdId: 'HH-B' }),
    );

    const entries = mockLedgerEntry.createMany.mock.calls[0][0].data;
    expect(entries).toEqual([
      expect.objectContaining({ householdId: 'HH-S', entryType: 'CREDIT', amount: '19.00' }),
      expect.objectContaining({ householdId: 'HH-B', entryType: 'DEBIT', amount: '19.00' }),
    ]);
  });

  it('always touches balances in the same order, whichever side is the seller', async () => {
    await service.createTrade(
      buildTradeDto({ sellerHouseholdId: 'HH-Z', buyerHouseholdId: 'HH-A' }),
    );
    const firstRun = mockHouseholdBalance.upsert.mock.calls.map(
      (call) => call[0].where.householdId,
    );

    jest.clearAllMocks();
    givenNewKey();

    await service.createTrade(
      buildTradeDto({ sellerHouseholdId: 'HH-A', buyerHouseholdId: 'HH-Z' }),
    );
    const secondRun = mockHouseholdBalance.upsert.mock.calls.map(
      (call) => call[0].where.householdId,
    );

    // Two trades in opposite directions between the same pair must not lock
    // the two rows in opposite orders, or they can deadlock each other.
    expect(firstRun).toEqual(['HH-A', 'HH-Z']);
    expect(secondRun).toEqual(['HH-A', 'HH-Z']);
  });

  it('returns money and energy as fixed-scale decimal strings', async () => {
    const { trade } = await service.createTrade(buildTradeDto());

    expect(trade).toMatchObject({
      energyKwh: '4.000',
      pricePerKwh: '4.7500',
      totalAmount: '19.00',
    });
  });
});

describe('TradesService - metrics', () => {
  function outcomes(text: string) {
    const counts: Record<string, number> = {};
    for (const match of text.matchAll(
      /solargrid_settlements_total\{outcome="(\w+)"[^}]*\} (\d+)/g,
    )) {
      counts[match[1]] = Number(match[2]);
    }
    return counts;
  }

  it('counts every settlement request by outcome', async () => {
    jest.clearAllMocks();
    const registry = new MetricsRegistry('billing-ledger-service');
    const service = new TradesService(mockPrisma, new LedgerMetrics(registry));

    givenNewKey();
    await service.createTrade(buildTradeDto());

    givenRecordedKey(tradeRequestFingerprint(buildTradeDto()));
    await service.createTrade(buildTradeDto());
    await expect(
      service.createTrade(buildTradeDto({ energyKwh: '5.000', totalAmount: '23.75' })),
    ).rejects.toThrow(IdempotencyConflictException);
    await expect(
      service.createTrade(buildTradeDto({ buyerHouseholdId: 'HH-SELLER-001' })),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(outcomes(await registry.render())).toEqual({
      recorded: 1,
      replayed: 1,
      idempotency_conflict: 1,
      rejected: 1,
    });
  });
});

describe('tradeRequestFingerprint', () => {
  it('is the same for the same trade written differently', () => {
    const canonical = tradeRequestFingerprint(buildTradeDto());

    expect(
      tradeRequestFingerprint(
        buildTradeDto({
          energyKwh: '4',
          pricePerKwh: '4.75',
          totalAmount: '19',
          completedAt: '2026-05-27T13:10:00.000+03:00',
        }),
      ),
    ).toBe(canonical);
  });

  it('ignores the correlation id, which identifies the caller rather than the trade', () => {
    expect(tradeRequestFingerprint(buildTradeDto({ correlationId: 'another-trace' }))).toBe(
      tradeRequestFingerprint(buildTradeDto()),
    );
  });

  it('changes when anything about the trade changes', () => {
    const canonical = tradeRequestFingerprint(buildTradeDto());

    expect(tradeRequestFingerprint(buildTradeDto({ energyKwh: '4.001' }))).not.toBe(canonical);
    expect(tradeRequestFingerprint(buildTradeDto({ buyerHouseholdId: 'HH-OTHER' }))).not.toBe(
      canonical,
    );
    expect(
      tradeRequestFingerprint(buildTradeDto({ completedAt: '2026-05-27T10:10:01.000Z' })),
    ).not.toBe(canonical);
  });
});
