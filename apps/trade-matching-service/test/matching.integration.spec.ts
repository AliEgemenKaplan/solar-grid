import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CompletedTradeDto } from '@solar-grid/shared-contracts';
import { PrismaClient } from '../generated/client';
import { MatchingService } from '../src/matching/matching.service';
import {
  BillingClient,
  BillingRejectedError,
  CreateTradeResponse,
} from '../src/clients/billing.client';
import { PricingClient } from '../src/clients/pricing.client';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(240_000);

/**
 * Stands in for billing-ledger-service and, like the real one, refuses to
 * record the same idempotency key twice. `recorded` is therefore the ledger:
 * if it ever holds two entries for one trade, we double billed.
 */
class FakeBilling {
  readonly calls: CompletedTradeDto[] = [];
  readonly recorded = new Map<string, CompletedTradeDto>();
  behaviour: 'ok' | 'unknown-outcome' | 'record-then-lose-the-answer' | 'reject' = 'ok';
  onCall?: () => Promise<void>;

  async createTrade(dto: CompletedTradeDto): Promise<CreateTradeResponse> {
    this.calls.push(dto);
    if (this.onCall) await this.onCall();

    if (this.behaviour === 'unknown-outcome') {
      throw new Error('timeout of 5000ms exceeded');
    }

    if (this.behaviour === 'reject') {
      throw new BillingRejectedError(400, 'billing rejected the trade with HTTP 400');
    }

    const duplicate = this.recorded.has(dto.idempotencyKey);
    if (!duplicate) this.recorded.set(dto.idempotencyKey, dto);

    if (this.behaviour === 'record-then-lose-the-answer') {
      // Billing committed, we never saw the response.
      throw new Error('socket hang up');
    }

    return { tradeId: dto.tradeId, duplicate };
  }
}

const fakePricing = {
  getCurrentPrice: async () => ({
    pricePerKwh: 4,
    currency: 'TRY',
    calculatedAt: new Date().toISOString(),
    supplyKwh: 0,
    demandKwh: 0,
  }),
};

describe('MatchingService against a real database', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let billing: FakeBilling;
  let service: MatchingService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start();
    const url = container.getConnectionUri();

    execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'ignore',
    });

    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.tradeMatch.deleteMany();
    await prisma.sellOffer.deleteMany();
    await prisma.buyRequest.deleteMany();

    billing = new FakeBilling();
    service = new MatchingService(
      prisma as unknown as PrismaService,
      fakePricing as unknown as PricingClient,
      billing as unknown as BillingClient,
    );
  });

  async function seed(offerKwh: number, requestKwh: number) {
    const offer = await prisma.sellOffer.create({
      data: {
        householdId: 'HH-SELLER',
        sourceEventId: randomUUID(),
        availableKwh: offerKwh,
        originalKwh: offerKwh,
        status: 'OPEN',
        correlationId: 'cid-seed',
      },
    });
    const request = await prisma.buyRequest.create({
      data: {
        householdId: 'HH-BUYER',
        sourceEventId: randomUUID(),
        requestedKwh: requestKwh,
        originalKwh: requestKwh,
        status: 'OPEN',
        correlationId: 'cid-seed',
      },
    });
    return { offer, request };
  }

  it('matches, bills once, and leaves the remainder of a partial fill open', async () => {
    const { offer, request } = await seed(10, 4);

    const result = await service.runMatching('cid-happy');

    expect(result).toMatchObject({ matched: 1, failed: 0, pending: 0 });
    expect(billing.calls).toHaveLength(1);
    expect(billing.recorded.size).toBe(1);

    const trade = await prisma.tradeMatch.findFirstOrThrow();
    expect(trade.status).toBe('COMPLETED');
    expect(trade.energyKwh).toBe(4);
    expect(trade.totalAmount).toBe(16);
    expect(trade.idempotencyKey).toBe(trade.tradeId);

    const offerAfter = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(offerAfter.availableKwh).toBe(6);
    expect(offerAfter.status).toBe('PARTIALLY_MATCHED');

    const requestAfter = await prisma.buyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.requestedKwh).toBe(0);
    expect(requestAfter.status).toBe('MATCHED');
  });

  it('reserves the energy before it calls billing', async () => {
    const { offer } = await seed(4, 4);
    let availableDuringCall: number | undefined;
    billing.onCall = async () => {
      const row = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
      availableDuringCall = row.availableKwh;
    };

    await service.runMatching('cid-order');

    expect(availableDuringCall).toBe(0);
  });

  it('keeps the trade reserved when billing does not answer, then settles it with the same key', async () => {
    const { offer } = await seed(10, 4);
    billing.behaviour = 'unknown-outcome';

    const first = await service.runMatching('cid-attempt-1');

    expect(first).toMatchObject({ matched: 0, failed: 0, pending: 1 });
    const reserved = await prisma.tradeMatch.findFirstOrThrow();
    expect(reserved.status).toBe('PENDING_BILLING');
    // The energy stays reserved; releasing it here is what used to let the
    // same kilowatt hours be sold and billed a second time.
    const offerDuring = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(offerDuring.availableKwh).toBe(6);

    billing.behaviour = 'ok';
    const second = await service.runMatching('cid-attempt-2');

    expect(second.settled).toBe(1);
    expect(await prisma.tradeMatch.count()).toBe(1);
    const settled = await prisma.tradeMatch.findFirstOrThrow();
    expect(settled.status).toBe('COMPLETED');
    expect(settled.billingAttempts).toBe(2);

    // Same trade, same key, identical payload on both attempts.
    expect(billing.calls).toHaveLength(2);
    expect(billing.calls[0].idempotencyKey).toBe(billing.calls[1].idempotencyKey);
    expect(billing.calls[0].completedAt).toBe(billing.calls[1].completedAt);
    expect(billing.recorded.size).toBe(1);
  });

  it('does not bill twice when billing recorded the trade but the answer was lost', async () => {
    await seed(4, 4);
    billing.behaviour = 'record-then-lose-the-answer';

    const first = await service.runMatching('cid-lost-1');
    expect(first.pending).toBe(1);
    expect(billing.recorded.size).toBe(1);

    billing.behaviour = 'ok';
    const second = await service.runMatching('cid-lost-2');

    expect(second.settled).toBe(1);
    // The retry carried the original key, so billing recognised it instead of
    // charging the households again.
    expect(billing.calls[1].idempotencyKey).toBe(billing.calls[0].idempotencyKey);
    expect(billing.recorded.size).toBe(1);
    expect(await prisma.tradeMatch.count()).toBe(1);
  });

  it('gives the energy back when billing rejects the trade outright', async () => {
    const { offer, request } = await seed(10, 4);
    billing.behaviour = 'reject';

    const result = await service.runMatching('cid-reject');

    expect(result).toMatchObject({ matched: 0, failed: 1, pending: 0 });
    const trade = await prisma.tradeMatch.findFirstOrThrow();
    expect(trade.status).toBe('FAILED');

    const offerAfter = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(offerAfter.availableKwh).toBe(10);
    expect(offerAfter.status).toBe('OPEN');
    const requestAfter = await prisma.buyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.requestedKwh).toBe(4);
    expect(requestAfter.status).toBe('OPEN');

    // Released energy is available to the next run.
    billing.behaviour = 'ok';
    const retry = await service.runMatching('cid-reject-retry');
    expect(retry.matched).toBe(1);
  });

  it('sells the same energy only once when two runs race', async () => {
    const { offer, request } = await seed(4, 4);

    const [a, b] = await Promise.all([
      service.runMatching('cid-race-a'),
      service.runMatching('cid-race-b'),
    ]);

    expect(a.matched + b.matched).toBe(1);
    expect(await prisma.tradeMatch.count()).toBe(1);
    expect(billing.recorded.size).toBe(1);

    const offerAfter = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(offerAfter.availableKwh).toBe(0);
    const requestAfter = await prisma.buyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(requestAfter.requestedKwh).toBe(0);
  });

  it('never oversells when several runs race over a larger offer', async () => {
    const { offer } = await seed(10, 0);
    await prisma.buyRequest.deleteMany();
    const requests = await Promise.all(
      ['HH-A', 'HH-B', 'HH-C', 'HH-D'].map((householdId) =>
        prisma.buyRequest.create({
          data: {
            householdId,
            sourceEventId: randomUUID(),
            requestedKwh: 4,
            originalKwh: 4,
            status: 'OPEN',
            correlationId: 'cid-seed',
          },
        }),
      ),
    );

    await Promise.all([
      service.runMatching('cid-multi-a'),
      service.runMatching('cid-multi-b'),
      service.runMatching('cid-multi-c'),
    ]);

    const offerAfter = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(offerAfter.availableKwh).toBe(0);

    const trades = await prisma.tradeMatch.findMany();
    const sold = trades.reduce((total, trade) => total + trade.energyKwh, 0);
    // The offer only ever held 10 kWh, however many runs competed for it.
    expect(sold).toBe(10);
    expect(trades.every((trade) => trade.status === 'COMPLETED')).toBe(true);

    const remaining = await prisma.buyRequest.findMany({
      where: { id: { in: requests.map((r) => r.id) } },
    });
    expect(remaining.every((request) => request.requestedKwh >= 0)).toBe(true);
  });
});
