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
 * Price statistics against a real PostgreSQL, through the runtime role the
 * containers use.
 */
describe('pricing statistics', () => {
  let database: RuntimeDatabase;
  let owner: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    // The rule the service seeds at startup.
    await owner.pricingRule.create({
      data: {
        basePrice: '4',
        minPrice: '2.5',
        maxPrice: '7',
        currency: 'TRY',
        isActive: true,
      } as never,
    });
    await owner.priceSnapshot.createMany({
      data: [
        snapshot('40', '20', '2', '2026-05-27T00:30:00.000Z'),
        snapshot('50', '50', '4', '2026-05-27T02:30:00.000Z'),
        snapshot('30', '60', '6', '2026-05-28T01:00:00.000Z'),
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
      title: 'Pricing Engine Service',
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
    it('averages the prices and the supply and demand behind them', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body).toMatchObject({
        range: { from: null, to: null },
        snapshots: 3,
        // (2 + 4 + 6) / 3
        averagePricePerKwh: '4.0000',
        minPricePerKwh: '2.0000',
        maxPricePerKwh: '6.0000',
        // (40 + 50 + 30) / 3 and (20 + 50 + 60) / 3
        averageSupplyKwh: '40.000',
        averageDemandKwh: '43.333',
      });
    });

    it('reports the newest snapshot in the window and the band in force', async () => {
      const { body } = await get('/stats/summary?to=2026-05-28').expect(200);

      expect(body.latest).toEqual({
        pricePerKwh: '4.0000',
        supplyKwh: '50.000',
        demandKwh: '50.000',
        calculatedAt: '2026-05-27T02:30:00.000Z',
      });
      expect(body.band).toEqual({
        basePrice: '4.0000',
        minPrice: '2.5000',
        maxPrice: '7.0000',
        currency: 'TRY',
      });
    });

    it('reports a window with no snapshots without inventing a price', async () => {
      const { body } = await get('/stats/summary?from=2020-01-01&to=2020-01-02').expect(200);

      expect(body).toMatchObject({
        snapshots: 0,
        averagePricePerKwh: null,
        minPricePerKwh: null,
        maxPricePerKwh: null,
        averageSupplyKwh: '0.000',
        latest: null,
      });
      // The band is in force whether or not anything was priced.
      expect(body.band).toMatchObject({ basePrice: '4.0000' });
    });
  });

  describe('GET /stats/trends', () => {
    it('buckets prices by day and leaves the quiet days visible', async () => {
      const { body } = await get('/stats/trends?bucket=day&from=2026-05-26&to=2026-05-29').expect(
        200,
      );

      expect(body.buckets).toEqual([
        {
          bucketStart: '2026-05-26T00:00:00.000Z',
          snapshots: 0,
          averagePricePerKwh: null,
          minPricePerKwh: null,
          maxPricePerKwh: null,
          averageSupplyKwh: '0.000',
          averageDemandKwh: '0.000',
        },
        {
          bucketStart: '2026-05-27T00:00:00.000Z',
          snapshots: 2,
          averagePricePerKwh: '3.0000',
          minPricePerKwh: '2.0000',
          maxPricePerKwh: '4.0000',
          averageSupplyKwh: '45.000',
          averageDemandKwh: '35.000',
        },
        {
          bucketStart: '2026-05-28T00:00:00.000Z',
          snapshots: 1,
          averagePricePerKwh: '6.0000',
          minPricePerKwh: '6.0000',
          maxPricePerKwh: '6.0000',
          averageSupplyKwh: '30.000',
          averageDemandKwh: '60.000',
        },
      ]);
    });

    it('buckets by hour', async () => {
      const { body } = await get(
        '/stats/trends?bucket=hour&from=2026-05-27T00:00:00Z&to=2026-05-27T03:00:00Z',
      ).expect(200);

      expect(body.buckets.map((b: { snapshots: number }) => b.snapshots)).toEqual([1, 0, 1]);
    });
  });

  describe('refusing what it cannot answer', () => {
    it.each([
      ['a malformed bound', 400, '/stats/summary?from=last-week'],
      ['an unknown bucket', 400, '/stats/trends?bucket=minute'],
      ['a parameter this endpoint does not have', 400, '/stats/summary?householdId=HH-A'],
      ['a backwards window', 422, '/stats/summary?from=2026-06-01&to=2026-05-01'],
      ['too many buckets', 422, '/stats/trends?bucket=hour&from=2026-01-01&to=2026-06-01'],
    ])('answers %s with %i', async (_case, expected, url) => {
      const { body } = await get(url as string)
        .set('x-correlation-id', 'pricing-stats-refusal')
        .expect(expected as number);

      expect(body.correlationId).toBe('pricing-stats-refusal');
      expect(body).not.toHaveProperty('stack');
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
});

function snapshot(
  totalSupplyKwh: string,
  totalDemandKwh: string,
  calculatedPrice: string,
  createdAt: string,
) {
  return {
    totalSupplyKwh,
    totalDemandKwh,
    calculatedPrice,
    currency: 'TRY',
    createdAt: new Date(createdAt),
  };
}
