import { BadRequestException } from '@nestjs/common';
import { TradesService } from '../src/trades/trades.service';
import { CreateTradeDto } from '../src/trades/dto/create-trade.dto';

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

describe('TradesService - idempotency', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
  });

  it('records the trade, both ledger entries and both balances on the first call', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    mockCompletedTrade.create.mockResolvedValue(storedTrade);
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.createMany.mockResolvedValue({ count: 2 });
    mockHouseholdBalance.upsert.mockResolvedValue({});

    const result = await service.createTrade(buildTradeDto());

    expect(result?.duplicate).toBe(false);
    expect(mockCompletedTrade.create).toHaveBeenCalledTimes(1);
    expect(mockLedgerEntry.createMany).toHaveBeenCalledTimes(1);
    expect(mockHouseholdBalance.upsert).toHaveBeenCalledTimes(2);
  });

  it('returns the recorded trade without writing anything when the key is known', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue({ key: 'TRD-001', tradeId: 'TRD-001' });
    mockCompletedTrade.findUnique.mockResolvedValue(storedTrade);

    const result = await service.createTrade(buildTradeDto());

    expect(result?.duplicate).toBe(true);
    expect(mockCompletedTrade.create).not.toHaveBeenCalled();
    expect(mockLedgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockHouseholdBalance.upsert).not.toHaveBeenCalled();
  });

  it('refuses a trade where a household is both sides', async () => {
    await expect(
      service.createTrade(buildTradeDto({ buyerHouseholdId: 'HH-SELLER-001' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockIdempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(mockCompletedTrade.create).not.toHaveBeenCalled();
  });
});

describe('TradesService - money movement', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    mockCompletedTrade.create.mockResolvedValue(storedTrade);
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.createMany.mockResolvedValue({ count: 2 });
    mockHouseholdBalance.upsert.mockResolvedValue({});
  });

  it('credits the seller and debits the buyer by the same amount', async () => {
    await service.createTrade(
      buildTradeDto({
        sellerHouseholdId: 'HH-S',
        buyerHouseholdId: 'HH-B',
        totalAmount: '19.00',
      }),
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
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    mockCompletedTrade.create.mockResolvedValue(storedTrade);
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.createMany.mockResolvedValue({ count: 2 });
    mockHouseholdBalance.upsert.mockResolvedValue({});

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
    const result = await service.createTrade(buildTradeDto());

    expect(result).toMatchObject({
      energyKwh: '4.000',
      pricePerKwh: '4.7500',
      totalAmount: '19.00',
    });
  });
});
