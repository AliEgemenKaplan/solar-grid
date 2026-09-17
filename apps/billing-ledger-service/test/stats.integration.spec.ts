import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpApp, RateLimitModule } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { StatsModule } from '../src/stats/stats.module';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';
import { stopContainer } from './support/outages';

jest.setTimeout(300_000);

const OPERATOR_TOKEN = 'test-operator-token-0123456789abcdef0123';
const INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef0123';
const ORIGINAL_ENV = { ...process.env };

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
 * Billing statistics against a real PostgreSQL, through the runtime role the
 * containers use. Two trades, four ledger entries: small enough that every
 * total below is arithmetic anyone can check.
 */
describe('billing statistics', () => {
  let database: RuntimeDatabase;
  let owner: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    await owner.completedTrade.createMany({
      data: [
        completedTrade('T1', 'HH-A', 'HH-B', '10', '4', '40', '2026-05-27T00:30:00.000Z'),
        completedTrade('T2', 'HH-C', 'HH-B', '5', '5', '25', '2026-05-28T02:30:00.000Z'),
      ] as never,
    });
    await owner.ledgerEntry.createMany({
      data: [
        entry('T1', 'HH-A', 'CREDIT', '40', '2026-05-27T00:30:00.000Z'),
        entry('T1', 'HH-B', 'DEBIT', '40', '2026-05-27T00:30:00.000Z'),
        entry('T2', 'HH-C', 'CREDIT', '25', '2026-05-28T02:30:00.000Z'),
        entry('T2', 'HH-B', 'DEBIT', '25', '2026-05-28T02:30:00.000Z'),
      ] as never,
    });
    await owner.householdBalance.createMany({
      data: [
        { householdId: 'HH-A', balance: '40', currency: 'TRY' },
        { householdId: 'HH-B', balance: '-65', currency: 'TRY' },
        { householdId: 'HH-C', balance: '25', currency: 'TRY' },
        { householdId: 'HH-D', balance: '0', currency: 'TRY' },
      ] as never,
    });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      OPERATOR_API_TOKEN: OPERATOR_TOKEN,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      RATE_LIMIT_ENABLED: 'false',
    };

    const moduleRef = await Test.createTestingModule({ imports: [StatsOnlyModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app, {
      title: 'Billing Ledger Service',
      description: 'test',
      tags: ['Statistics'],
      credentials: ['operator', 'internal-service'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    // The last test takes the database away on purpose, so stopping it again
    // here is allowed to be a no-op.
    await database?.container.stop().catch(() => undefined);
    process.env = ORIGINAL_ENV;
  });

  const get = (url: string) =>
    request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${OPERATOR_TOKEN}`);

  describe('GET /stats/summary', () => {
    it('adds up what was settled', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body.currency).toBe('TRY');
      expect(body.trades).toEqual({
        trades: 2,
        energyKwh: '15.000',
        volume: '65.00',
        averagePricePerKwh: '4.5000',
        volumeWeightedPricePerKwh: '4.3333',
        minPricePerKwh: '4.0000',
        maxPricePerKwh: '5.0000',
        households: 3,
      });
    });

    it('shows a ledger that balances', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body.ledger).toEqual({
        entries: 4,
        credited: '65.00',
        debited: '65.00',
        // Every trade credits one household exactly what it debits another,
        // so anything but zero here means an entry is missing.
        net: '0.00',
        households: 3,
      });
    });

    it('reports the balances as they stand, whatever window was asked for', async () => {
      const { body } = await get('/stats/summary?from=2020-01-01&to=2020-01-02').expect(200);

      expect(body.trades).toMatchObject({ trades: 0, volume: '0.00', averagePricePerKwh: null });
      expect(body.ledger).toMatchObject({ entries: 0, credited: '0.00', net: '0.00' });
      expect(body.balances).toEqual({
        households: 4,
        inCredit: 2,
        inDebit: 1,
        settled: 1,
        totalCredit: '65.00',
        totalDebit: '65.00',
      });
    });

    it('counts trades by when they completed', async () => {
      const { body } = await get('/stats/summary?from=2026-05-28').expect(200);

      expect(body.trades).toMatchObject({ trades: 1, volume: '25.00', energyKwh: '5.000' });
      expect(body.ledger).toMatchObject({ entries: 2, credited: '25.00', debited: '25.00' });
    });
  });

  describe('GET /stats/households', () => {
    it('reports credits and debits per household, most money moved first', async () => {
      const { body } = await get('/stats/households').expect(200);

      expect(body.total).toBe(3);
      expect(body.items[0]).toEqual({
        householdId: 'HH-B',
        entries: 2,
        credits: 0,
        debits: 2,
        credited: '0.00',
        debited: '65.00',
        net: '-65.00',
        firstEntryAt: '2026-05-27T00:30:00.000Z',
        lastEntryAt: '2026-05-28T02:30:00.000Z',
      });
      expect(body.items.map((item: { householdId: string }) => item.householdId)).toEqual([
        'HH-B',
        'HH-A',
        'HH-C',
      ]);
    });

    it('filters to one household', async () => {
      const { body } = await get('/stats/households?householdId=HH-A').expect(200);

      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ credits: 1, credited: '40.00', net: '40.00' });
    });

    it('narrows to the window', async () => {
      const { body } = await get('/stats/households?from=2026-05-28').expect(200);

      expect(body.items.map((item: { householdId: string }) => item.householdId)).toEqual([
        'HH-B',
        'HH-C',
      ]);
      expect(body.items[1]).toMatchObject({ credited: '25.00', net: '25.00' });
    });

    it('is empty for a household that never traded', async () => {
      const { body } = await get('/stats/households?householdId=HH-NOBODY').expect(200);

      expect(body).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('GET /stats/trends', () => {
    it('buckets settled trades by day', async () => {
      const { body } = await get('/stats/trends?bucket=day&from=2026-05-26&to=2026-05-29').expect(
        200,
      );

      expect(body.buckets).toEqual([
        {
          bucketStart: '2026-05-26T00:00:00.000Z',
          trades: 0,
          energyKwh: '0.000',
          volume: '0.00',
          averagePricePerKwh: null,
        },
        {
          bucketStart: '2026-05-27T00:00:00.000Z',
          trades: 1,
          energyKwh: '10.000',
          volume: '40.00',
          averagePricePerKwh: '4.0000',
        },
        {
          bucketStart: '2026-05-28T00:00:00.000Z',
          trades: 1,
          energyKwh: '5.000',
          volume: '25.00',
          averagePricePerKwh: '5.0000',
        },
      ]);
    });

    it('buckets by week from the Monday', async () => {
      const { body } = await get('/stats/trends?bucket=week&from=2026-05-25&to=2026-06-01').expect(
        200,
      );

      expect(body.buckets).toHaveLength(1);
      expect(body.buckets[0]).toMatchObject({
        bucketStart: '2026-05-25T00:00:00.000Z',
        trades: 2,
        volume: '65.00',
      });
    });
  });

  describe('refusing what it cannot answer', () => {
    it.each([
      ['a malformed bound', 400, '/stats/summary?to=soon'],
      ['an unknown bucket', 400, '/stats/trends?bucket=year'],
      ['a backwards window', 422, '/stats/summary?from=2026-06-01&to=2026-05-01'],
      ['too many buckets', 422, '/stats/trends?bucket=day&from=2024-01-01&to=2026-01-01'],
    ])('answers %s with %i', async (_case, expected, url) => {
      const { body } = await get(url as string)
        .set('x-correlation-id', 'billing-stats-refusal')
        .expect(expected as number);

      expect(body.correlationId).toBe('billing-stats-refusal');
      expect(JSON.stringify(body)).not.toMatch(/prisma|postgres|5432|solargrid_app/i);
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
  });

  // Last, because it takes the database away and does not give it back. The
  // service should say it cannot answer rather than half answer or say too
  // much about why.
  describe('when the database is gone', () => {
    it('answers 503 without naming the database', async () => {
      stopContainer(database.container);

      const { body } = await get('/stats/summary')
        .set('x-correlation-id', 'billing-stats-outage')
        .expect(503);

      expect(body).toMatchObject({
        statusCode: 503,
        code: 'DOWNSTREAM_UNAVAILABLE',
        correlationId: 'billing-stats-outage',
      });
      expect(JSON.stringify(body)).not.toMatch(/prisma|postgres|5432|solargrid_app|password/i);
      expect(body).not.toHaveProperty('stack');
    });
  });
});

function completedTrade(
  tradeId: string,
  sellerHouseholdId: string,
  buyerHouseholdId: string,
  energyKwh: string,
  pricePerKwh: string,
  totalAmount: string,
  completedAt: string,
) {
  return {
    tradeId,
    sellerHouseholdId,
    buyerHouseholdId,
    energyKwh,
    pricePerKwh,
    totalAmount,
    currency: 'TRY',
    idempotencyKey: `idem-${tradeId}`,
    correlationId: `cid-${tradeId}`,
    completedAt: new Date(completedAt),
  };
}

function entry(
  tradeId: string,
  householdId: string,
  entryType: string,
  amount: string,
  createdAt: string,
) {
  return {
    tradeId,
    householdId,
    entryType,
    amount,
    currency: 'TRY',
    correlationId: `cid-${tradeId}`,
    createdAt: new Date(createdAt),
  };
}
