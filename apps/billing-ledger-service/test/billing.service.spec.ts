import { TradesService } from '../src/trades/trades.service';
import { CreateTradeDto } from '../src/trades/dto/create-trade.dto';

const mockIdempotencyKey = {
  findUnique: jest.fn(),
  create: jest.fn(),
};
const mockCompletedTrade = {
  create: jest.fn(),
  findUnique: jest.fn(),
};
const mockLedgerEntry = { create: jest.fn() };
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
  energyKwh: 4,
  pricePerKwh: 4.75,
  totalAmount: 19,
  currency: 'TRY',
  idempotencyKey: 'idem-key-001',
  correlationId: 'corr-001',
  completedAt: '2026-05-27T10:10:00.000Z',
  ...overrides,
});

describe('TradesService - Idempotency', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
  });

  it('should create trade and ledger entries on first call', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    const mockTrade = { id: 'rec-001', tradeId: 'TRD-001', totalAmount: 19 };
    mockCompletedTrade.create.mockResolvedValue(mockTrade);
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.create.mockResolvedValue({});
    mockHouseholdBalance.upsert.mockResolvedValue({});

    const result = await service.createTrade(buildTradeDto());

    expect(result.duplicate).toBe(false);
    expect(mockCompletedTrade.create).toHaveBeenCalledTimes(1);
    expect(mockLedgerEntry.create).toHaveBeenCalledTimes(2);
    expect(mockHouseholdBalance.upsert).toHaveBeenCalledTimes(2);
  });

  it('should NOT create duplicate ledger entries when idempotencyKey already exists', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue({ key: 'idem-key-001', tradeId: 'TRD-001' });
    mockCompletedTrade.findUnique.mockResolvedValue({ tradeId: 'TRD-001', totalAmount: 19 });

    const result = await service.createTrade(buildTradeDto());

    expect(result.duplicate).toBe(true);
    expect(mockCompletedTrade.create).not.toHaveBeenCalled();
    expect(mockLedgerEntry.create).not.toHaveBeenCalled();
    expect(mockHouseholdBalance.upsert).not.toHaveBeenCalled();
  });
});

describe('TradesService - Balance Updates', () => {
  let service: TradesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TradesService(mockPrisma);
  });

  it('should increment seller balance and decrement buyer balance', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    mockCompletedTrade.create.mockResolvedValue({ tradeId: 'TRD-001' });
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.create.mockResolvedValue({});
    mockHouseholdBalance.upsert.mockResolvedValue({});

    await service.createTrade(
      buildTradeDto({ totalAmount: 19, sellerHouseholdId: 'HH-S', buyerHouseholdId: 'HH-B' }),
    );

    const sellerCall = mockHouseholdBalance.upsert.mock.calls.find(
      (c) => c[0].where.householdId === 'HH-S',
    );
    const buyerCall = mockHouseholdBalance.upsert.mock.calls.find(
      (c) => c[0].where.householdId === 'HH-B',
    );

    expect(sellerCall[0].update.balance.increment).toBe(19);
    expect(buyerCall[0].update.balance.decrement).toBe(19);
  });

  it('should create CREDIT entry for seller and DEBIT entry for buyer', async () => {
    mockIdempotencyKey.findUnique.mockResolvedValue(null);
    mockCompletedTrade.create.mockResolvedValue({ tradeId: 'TRD-001' });
    mockIdempotencyKey.create.mockResolvedValue({});
    mockLedgerEntry.create.mockResolvedValue({});
    mockHouseholdBalance.upsert.mockResolvedValue({});

    await service.createTrade(
      buildTradeDto({ sellerHouseholdId: 'HH-S', buyerHouseholdId: 'HH-B' }),
    );

    const creditEntry = mockLedgerEntry.create.mock.calls.find(
      (c) => c[0].data.entryType === 'CREDIT',
    );
    const debitEntry = mockLedgerEntry.create.mock.calls.find(
      (c) => c[0].data.entryType === 'DEBIT',
    );

    expect(creditEntry[0].data.householdId).toBe('HH-S');
    expect(debitEntry[0].data.householdId).toBe('HH-B');
  });
});
