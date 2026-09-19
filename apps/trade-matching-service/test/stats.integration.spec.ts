import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpApp, RateLimitModule } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { StatsModule } from '../src/stats/stats.module';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';

jest.setTimeout(300_000);

const OPERATOR_TOKEN = 'test-operator-token-0123456789abcdef0123';
const INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef0123';
const ORIGINAL_ENV = { ...process.env };
const DASHBOARD_ORIGIN = 'http://localhost:8080';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    RateLimitModule.forRoot(),
    PrismaModule,
    StatsModule,
  ],
})
class StatsOnlyModule {}

/**
 * Market statistics against a real PostgreSQL, through the runtime role the
 * containers use. The seeded market is small enough to add up by hand, which
 * is the point: every total below is checked against arithmetic, not against
 * whatever the query happened to return.
 */
describe('trade-matching statistics', () => {
  let database: RuntimeDatabase;
  let owner: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    await owner.sellOffer.createMany({
      data: [
        offer('OF-1', 'HH-A', '10', '0', 'MATCHED', '2026-05-27T00:00:00.000Z'),
        offer('OF-2', 'HH-C', '8', '3', 'PARTIALLY_MATCHED', '2026-05-27T02:00:00.000Z'),
        offer('OF-3', 'HH-C', '5', '3', 'PARTIALLY_MATCHED', '2026-05-28T00:00:00.000Z'),
        offer('OF-4', 'HH-E', '4', '4', 'OPEN', '2026-05-28T02:00:00.000Z'),
      ] as never,
    });
    await owner.buyRequest.createMany({
      data: [
        buyRequest('RQ-1', 'HH-B', '10', '0', 'MATCHED', '2026-05-27T00:00:00.000Z'),
        buyRequest('RQ-2', 'HH-D', '6', '1', 'PARTIALLY_MATCHED', '2026-05-27T02:00:00.000Z'),
      ] as never,
    });
    await owner.tradeMatch.createMany({
      data: [
        trade('T1', 'HH-A', 'HH-B', '10', '4', '40', 'COMPLETED', 'OF-1', 'RQ-1', '00:30'),
        trade('T2', 'HH-C', 'HH-D', '5', '5', '25', 'COMPLETED', 'OF-2', 'RQ-2', '02:30'),
        trade('T3', 'HH-C', 'HH-D', '2', '3', '6', 'PENDING_BILLING', 'OF-3', 'RQ-2', '01:00', 28),
        trade('T4', 'HH-A', 'HH-B', '1', '4', '4', 'FAILED', 'OF-1', 'RQ-1', '03:00', 28),
      ] as never,
    });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      OPERATOR_API_TOKEN: OPERATOR_TOKEN,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      RATE_LIMIT_ENABLED: 'false',
      // As the Docker stack runs it: the operator dashboard's origin only.
      CORS_ALLOWED_ORIGINS: DASHBOARD_ORIGIN,
    };

    const moduleRef = await Test.createTestingModule({ imports: [StatsOnlyModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app, {
      title: 'Trade Matching Service',
      description: 'test',
      tags: ['Statistics'],
      credentials: ['operator'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  const get = (url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${OPERATOR_TOKEN}`);

  describe('GET /stats/summary', () => {
    it('counts the trades by outcome and adds up what settled', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body.currency).toBe('TRY');
      expect(body.households).toBe(4);
      expect(body.trades).toEqual({ total: 4, completed: 2, pendingBilling: 1, failed: 1 });
      expect(body.completed).toEqual({
        energyKwh: '15.000',
        volume: '65.00',
        // The mean of 4.0000 and 5.0000 ...
        averagePricePerKwh: '4.5000',
        // ... and what the neighbourhood actually paid: 65.00 over 15 kWh.
        volumeWeightedPricePerKwh: '4.3333',
        minPricePerKwh: '4.0000',
        maxPricePerKwh: '5.0000',
      });
      expect(body.pending).toEqual({ energyKwh: '2.000', volume: '6.00' });
    });

    it('reports what was offered, what traded and what is still open', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body.offers).toEqual({
        total: 4,
        open: 1,
        partiallyMatched: 2,
        matched: 1,
        cancelled: 0,
        totalKwh: '27.000',
        matchedKwh: '17.000',
        openKwh: '10.000',
      });
      expect(body.requests).toEqual({
        total: 2,
        open: 0,
        partiallyMatched: 1,
        matched: 1,
        cancelled: 0,
        totalKwh: '16.000',
        matchedKwh: '15.000',
        openKwh: '1.000',
      });
    });

    it('reports a window with no completed trades without inventing a price', async () => {
      const { body } = await get('/stats/summary?from=2026-05-28').expect(200);

      expect(body.trades).toEqual({ total: 2, completed: 0, pendingBilling: 1, failed: 1 });
      expect(body.completed).toMatchObject({
        energyKwh: '0.000',
        volume: '0.00',
        averagePricePerKwh: null,
        volumeWeightedPricePerKwh: null,
        minPricePerKwh: null,
        maxPricePerKwh: null,
      });
    });

    it('reports an empty window as zeros', async () => {
      const { body } = await get('/stats/summary?from=2020-01-01&to=2020-01-02').expect(200);

      expect(body.trades).toEqual({ total: 0, completed: 0, pendingBilling: 0, failed: 0 });
      expect(body.households).toBe(0);
      expect(body.offers).toMatchObject({ total: 0, totalKwh: '0.000', openKwh: '0.000' });
      expect(body.currency).toBe('TRY');
    });
  });

  describe('GET /stats/households', () => {
    it('counts both sides of a trade, busiest by money first', async () => {
      const { body } = await get('/stats/households').expect(200);

      expect(body.total).toBe(4);
      expect(body.items.map((item: { householdId: string }) => item.householdId)).toEqual([
        'HH-A',
        'HH-B',
        'HH-C',
        'HH-D',
      ]);
      expect(body.items[0]).toEqual({
        householdId: 'HH-A',
        tradesAsSeller: 1,
        tradesAsBuyer: 0,
        soldKwh: '10.000',
        boughtKwh: '0.000',
        sellVolume: '40.00',
        buyVolume: '0.00',
        netVolume: '40.00',
        lastTradeAt: '2026-05-27T00:30:00.000Z',
      });
      expect(body.items[1]).toMatchObject({
        householdId: 'HH-B',
        tradesAsBuyer: 1,
        boughtKwh: '10.000',
        buyVolume: '40.00',
        netVolume: '-40.00',
      });
    });

    it('filters to one household, on whichever side it traded', async () => {
      const { body } = await get('/stats/households?householdId=HH-D').expect(200);

      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ tradesAsBuyer: 1, boughtKwh: '5.000' });
    });

    it('leaves out trades that have not settled', async () => {
      // HH-E only ever offered, and the trades on the 28th are pending or failed.
      const { body } = await get('/stats/households?from=2026-05-28').expect(200);

      expect(body).toMatchObject({ items: [], total: 0 });
    });

    it('pages deterministically', async () => {
      const first = await get('/stats/households?page=1&limit=2').expect(200);
      const second = await get('/stats/households?page=2&limit=2').expect(200);

      expect(first.body.total).toBe(4);
      expect(
        [...first.body.items, ...second.body.items].map(
          (i: { householdId: string }) => i.householdId,
        ),
      ).toEqual(['HH-A', 'HH-B', 'HH-C', 'HH-D']);
    });
  });

  describe('GET /stats/trends', () => {
    it('buckets by day, with the quiet outcomes visible', async () => {
      const { body } = await get('/stats/trends?bucket=day&from=2026-05-27&to=2026-05-29').expect(
        200,
      );

      expect(body.buckets).toEqual([
        {
          bucketStart: '2026-05-27T00:00:00.000Z',
          trades: 2,
          completed: 2,
          energyKwh: '15.000',
          volume: '65.00',
          averagePricePerKwh: '4.5000',
        },
        {
          bucketStart: '2026-05-28T00:00:00.000Z',
          trades: 2,
          completed: 0,
          energyKwh: '0.000',
          volume: '0.00',
          averagePricePerKwh: null,
        },
      ]);
    });

    it('reports an hour nothing happened in as zeros', async () => {
      const { body } = await get(
        '/stats/trends?bucket=hour&from=2026-05-27T00:00:00Z&to=2026-05-27T03:00:00Z',
      ).expect(200);

      expect(body.buckets.map((b: { trades: number }) => b.trades)).toEqual([1, 0, 1]);
      expect(body.buckets[0]).toMatchObject({ volume: '40.00', averagePricePerKwh: '4.0000' });
      expect(body.buckets[1]).toMatchObject({ volume: '0.00', averagePricePerKwh: null });
    });
  });

  describe('refusing what it cannot answer', () => {
    it.each([
      ['a malformed bound', 400, '/stats/summary?from=yesterday'],
      ['a time without an offset', 400, '/stats/summary?from=2026-05-27T10:00:00'],
      ['an unknown bucket', 400, '/stats/trends?bucket=month'],
      ['a household id with room for mischief', 400, '/stats/households?householdId=HH%20A%3B--'],
      ['a page nobody needs', 400, '/stats/households?page=0'],
      ['a backwards window', 422, '/stats/summary?from=2026-06-01&to=2026-05-01'],
      ['a window wider than a year', 422, '/stats/summary?from=2024-01-01&to=2026-01-01'],
      ['too many buckets', 422, '/stats/trends?bucket=hour&from=2026-01-01&to=2026-06-01'],
    ])('answers %s with %i', async (_case, expected, url) => {
      const { body } = await get(url as string)
        .set('x-correlation-id', 'stats-refusal')
        .expect(expected as number);

      expect(body.correlationId).toBe('stats-refusal');
      expect(body).not.toHaveProperty('stack');
      expect(JSON.stringify(body)).not.toMatch(/prisma|postgres|SELECT/i);
    });
  });

  /**
   * The dashboard is a browser app on its own origin, so every statistics
   * request it makes is cross-origin and carries the operator token in a
   * header. The browser asks first; the answer has to allow exactly that.
   */
  describe('from the operator dashboard in a browser', () => {
    it('allows the preflight for an authenticated request from the dashboard', async () => {
      const response = await request(app.getHttpServer())
        .options('/stats/summary')
        .set('Origin', DASHBOARD_ORIGIN)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,x-correlation-id')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
      expect(response.headers['access-control-allow-headers']).toMatch(/Authorization/);
      expect(response.headers['access-control-allow-headers']).toMatch(/x-correlation-id/);
      // Tokens travel in a header, never as cookies.
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('lets the dashboard read the answer and its correlation id', async () => {
      const response = await get('/stats/summary').set('Origin', DASHBOARD_ORIGIN).expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
      expect(response.headers['access-control-expose-headers']).toMatch(/x-correlation-id/);
    });

    it('lets the dashboard read a refusal, so it can sign the operator out', async () => {
      const response = await request(app.getHttpServer())
        .get('/stats/summary')
        .set('Origin', DASHBOARD_ORIGIN)
        .expect(401);

      expect(response.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
    });

    it('gives any other origin nothing it could read', async () => {
      const preflight = await request(app.getHttpServer())
        .options('/stats/summary')
        .set('Origin', 'http://evil.example')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization');
      const answer = await get('/stats/summary').set('Origin', 'http://evil.example');

      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('who may read the statistics', () => {
    it.each([
      ['no token', 401, undefined],
      ['the service token', 403, INTERNAL_TOKEN],
      ['the operator token', 200, OPERATOR_TOKEN],
    ])('answers %s with %i', async (_case, expected, token) => {
      const call = request(app.getHttpServer()).get('/stats/summary');
      if (token) call.set('Authorization', `Bearer ${token}`);
      await call.expect(expected as number);
    });

    it.each(['/stats/households', '/stats/trends'])('protects %s as well', async (url) => {
      await request(app.getHttpServer()).get(url).expect(401);
    });
  });
});

function offer(
  id: string,
  householdId: string,
  originalKwh: string,
  availableKwh: string,
  status: string,
  createdAt: string,
) {
  return {
    id,
    householdId,
    originalKwh,
    availableKwh,
    status,
    correlationId: `cid-${id}`,
    createdAt: new Date(createdAt),
  };
}

function buyRequest(
  id: string,
  householdId: string,
  originalKwh: string,
  requestedKwh: string,
  status: string,
  createdAt: string,
) {
  return {
    id,
    householdId,
    originalKwh,
    requestedKwh,
    status,
    correlationId: `cid-${id}`,
    createdAt: new Date(createdAt),
  };
}

function trade(
  tradeId: string,
  sellerHouseholdId: string,
  buyerHouseholdId: string,
  energyKwh: string,
  pricePerKwh: string,
  totalAmount: string,
  status: string,
  offerId: string,
  requestId: string,
  time: string,
  day = 27,
) {
  return {
    tradeId,
    sellerHouseholdId,
    buyerHouseholdId,
    energyKwh,
    pricePerKwh,
    totalAmount,
    currency: 'TRY',
    status,
    offerId,
    requestId,
    idempotencyKey: `idem-${tradeId}`,
    correlationId: `cid-${tradeId}`,
    createdAt: new Date(`2026-05-${day}T${time}:00.000Z`),
  };
}
