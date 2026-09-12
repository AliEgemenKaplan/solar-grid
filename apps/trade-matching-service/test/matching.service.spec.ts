import { MatchingService } from '../src/matching/matching.service';

const mockSellOffer = (id: string, householdId: string, availableKwh: number) => ({
  id,
  householdId,
  availableKwh,
  originalKwh: availableKwh,
  status: 'OPEN',
  correlationId: 'cid-001',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockBuyRequest = (id: string, householdId: string, requestedKwh: number) => ({
  id,
  householdId,
  requestedKwh,
  originalKwh: requestedKwh,
  status: 'OPEN',
  correlationId: 'cid-001',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockPrice = {
  pricePerKwh: 4.0,
  currency: 'TRY',
  calculatedAt: new Date().toISOString(),
  supplyKwh: 50,
  demandKwh: 40,
};

function buildMocks() {
  const matchCreate = jest.fn().mockResolvedValue({ id: 'match-001', tradeId: 'TRD-001' });
  const matchUpdate = jest.fn().mockResolvedValue({});
  const offerUpdate = jest.fn().mockResolvedValue({});
  const requestUpdate = jest.fn().mockResolvedValue({});

  const mockPrisma: any = {
    sellOffer: {
      findMany: jest.fn(),
      update: offerUpdate,
    },
    buyRequest: {
      findMany: jest.fn(),
      update: requestUpdate,
    },
    tradeMatch: {
      create: matchCreate,
      update: matchUpdate,
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const mockPricingClient: any = { getCurrentPrice: jest.fn().mockResolvedValue(mockPrice) };
  const mockBillingClient: any = {
    createTrade: jest.fn().mockResolvedValue({ tradeId: 'TRD-001', duplicate: false }),
  };

  const service = new MatchingService(mockPrisma, mockPricingClient, mockBillingClient);
  return {
    service,
    mockPrisma,
    mockPricingClient,
    mockBillingClient,
    matchCreate,
    matchUpdate,
    offerUpdate,
    requestUpdate,
  };
}

describe('MatchingService.runMatching - FIFO matching', () => {
  it('should match a seller and buyer and mark both as MATCHED when fully consumed', async () => {
    const { service, mockPrisma, offerUpdate, requestUpdate, matchUpdate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([mockSellOffer('s1', 'HH-SELLER', 4)]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-BUYER', 4)]);

    const result = await service.runMatching('cid-001');

    expect(result.matched).toBe(1);
    expect(result.failed).toBe(0);
    expect(offerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'MATCHED', availableKwh: 0 }),
      }),
    );
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ status: 'MATCHED', requestedKwh: 0 }),
      }),
    );
  });

  it('should partially match and leave seller with remaining kWh', async () => {
    const { service, mockPrisma, offerUpdate, requestUpdate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([mockSellOffer('s1', 'HH-SELLER', 10)]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-BUYER', 4)]);

    const result = await service.runMatching('cid-001');

    expect(result.matched).toBe(1);
    expect(offerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ availableKwh: 6, status: 'PARTIALLY_MATCHED' }),
      }),
    );
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ requestedKwh: 0, status: 'MATCHED' }),
      }),
    );
  });

  it('should NOT match a household with itself', async () => {
    const { service, mockPrisma, matchCreate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([mockSellOffer('s1', 'HH-SAME', 10)]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-SAME', 4)]);

    const result = await service.runMatching('cid-001');

    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(matchCreate).not.toHaveBeenCalled();
  });

  it('should return early when no sellers are available', async () => {
    const { service, mockPrisma, matchCreate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-BUYER', 4)]);

    const result = await service.runMatching('cid-001');

    expect(result.matched).toBe(0);
    expect(matchCreate).not.toHaveBeenCalled();
  });

  it('should mark trade as FAILED when billing service throws', async () => {
    const { service, mockPrisma, mockBillingClient, matchUpdate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([mockSellOffer('s1', 'HH-SELLER', 4)]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-BUYER', 4)]);
    mockBillingClient.createTrade.mockRejectedValue(new Error('Billing service unavailable'));

    const result = await service.runMatching('cid-001');

    expect(result.failed).toBe(1);
    expect(matchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: 'Billing service unavailable',
        }),
      }),
    );
  });

  it('should calculate correct totalAmount (tradeKwh * pricePerKwh rounded to 2 decimals)', async () => {
    const { service, mockPrisma, matchCreate } = buildMocks();

    mockPrisma.sellOffer.findMany.mockResolvedValue([mockSellOffer('s1', 'HH-SELLER', 4)]);
    mockPrisma.buyRequest.findMany.mockResolvedValue([mockBuyRequest('b1', 'HH-BUYER', 4)]);

    await service.runMatching('cid-001');

    const createCall = matchCreate.mock.calls[0][0];
    expect(createCall.data.energyKwh).toBe(4);
    expect(createCall.data.pricePerKwh).toBe(4.0);
    expect(createCall.data.totalAmount).toBe(16.0); // 4 * 4.0
  });
});
