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
 * Energy statistics against a real PostgreSQL, through the runtime role the
 * containers use: an aggregate the least privileged role may not run is a bug
 * that would only appear in Docker, so it fails here instead.
 */
describe('smart-meter statistics', () => {
  let database: RuntimeDatabase;
  let owner: PrismaClient;
  let app: INestApplication;

  const reading = (
    householdId: string,
    production: string,
    consumption: string,
    net: string,
    timestamp: string,
  ) => ({
    householdId,
    productionKwh: production,
    consumptionKwh: consumption,
    netKwh: net,
    status: net.startsWith('-') ? 'DEMAND' : net === '0' ? 'BALANCED' : ('SURPLUS' as const),
    timestamp: new Date(timestamp),
  });

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });
    await owner.meterReading.createMany({
      data: [
        reading('HH-A', '10', '4', '6', '2026-05-27T00:30:00.000Z'),
        reading('HH-B', '3', '3', '0', '2026-05-27T00:45:00.000Z'),
        reading('HH-A', '1', '5', '-4', '2026-05-27T02:15:00.000Z'),
        reading('HH-C', '8.5', '2.25', '6.25', '2026-05-27T03:10:00.000Z'),
        reading('HH-A', '2', '7', '-5', '2026-05-28T01:00:00.000Z'),
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
      title: 'Smart Meter Service',
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
    it('adds up every reading when no window is given', async () => {
      const { body } = await get('/stats/summary').expect(200);

      expect(body).toEqual({
        range: { from: null, to: null },
        readings: 5,
        households: 3,
        productionKwh: '24.500',
        consumptionKwh: '21.250',
        netKwh: '3.250',
        // Surplus and demand are counted apart, so a neighbourhood that both
        // offers and needs energy does not net out to nothing.
        surplusKwh: '12.250',
        demandKwh: '9.000',
        firstReadingAt: '2026-05-27T00:30:00.000Z',
        lastReadingAt: '2026-05-28T01:00:00.000Z',
      });
    });

    it('includes from and excludes to', async () => {
      const { body } = await get(
        '/stats/summary?from=2026-05-27T00:30:00Z&to=2026-05-28T01:00:00Z',
      ).expect(200);

      expect(body.readings).toBe(4);
      expect(body.productionKwh).toBe('22.500');
      expect(body.range).toEqual({
        from: '2026-05-27T00:30:00.000Z',
        to: '2026-05-28T01:00:00.000Z',
      });
    });

    it('reads a date as midnight UTC', async () => {
      const { body } = await get('/stats/summary?from=2026-05-27&to=2026-05-28').expect(200);

      expect(body.readings).toBe(4);
      expect(body.demandKwh).toBe('4.000');
    });

    it('reports an empty window as zeros, not as missing', async () => {
      const { body } = await get('/stats/summary?from=2020-01-01&to=2020-01-02').expect(200);

      expect(body).toMatchObject({
        readings: 0,
        households: 0,
        productionKwh: '0.000',
        netKwh: '0.000',
        surplusKwh: '0.000',
        firstReadingAt: null,
        lastReadingAt: null,
      });
    });
  });

  describe('GET /stats/households', () => {
    it('lists each household, biggest producer first', async () => {
      const { body } = await get('/stats/households').expect(200);

      expect(body.total).toBe(3);
      expect(body.items.map((item: { householdId: string }) => item.householdId)).toEqual([
        'HH-A',
        'HH-C',
        'HH-B',
      ]);
      expect(body.items[0]).toEqual({
        householdId: 'HH-A',
        readings: 3,
        productionKwh: '13.000',
        consumptionKwh: '16.000',
        netKwh: '-3.000',
        surplusKwh: '6.000',
        demandKwh: '9.000',
        firstReadingAt: '2026-05-27T00:30:00.000Z',
        lastReadingAt: '2026-05-28T01:00:00.000Z',
      });
    });

    it('pages without losing the total', async () => {
      const first = await get('/stats/households?page=1&limit=2').expect(200);
      const second = await get('/stats/households?page=2&limit=2').expect(200);

      expect(first.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(first.body.items).toHaveLength(2);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].householdId).toBe('HH-B');
    });

    it('filters to one household', async () => {
      const { body } = await get('/stats/households?householdId=HH-C').expect(200);

      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ householdId: 'HH-C', productionKwh: '8.500' });
    });

    it('returns an empty page for a household that has never reported', async () => {
      const { body } = await get('/stats/households?householdId=HH-NOBODY').expect(200);

      expect(body).toMatchObject({ items: [], total: 0 });
    });

    it('applies the window to the per household totals', async () => {
      const { body } = await get('/stats/households?from=2026-05-28&householdId=HH-A').expect(200);

      expect(body.items[0]).toMatchObject({ readings: 1, productionKwh: '2.000' });
    });
  });

  describe('GET /stats/trends', () => {
    it('reports a quiet bucket as zeros rather than leaving a hole', async () => {
      const { body } = await get(
        '/stats/trends?bucket=hour&from=2026-05-27T00:00:00Z&to=2026-05-27T04:00:00Z',
      ).expect(200);

      expect(body.bucket).toBe('hour');
      expect(body.buckets).toHaveLength(4);
      expect(body.buckets[0]).toEqual({
        bucketStart: '2026-05-27T00:00:00.000Z',
        readings: 2,
        households: 2,
        productionKwh: '13.000',
        consumptionKwh: '7.000',
        netKwh: '6.000',
      });
      expect(body.buckets[1]).toEqual({
        bucketStart: '2026-05-27T01:00:00.000Z',
        readings: 0,
        households: 0,
        productionKwh: '0.000',
        consumptionKwh: '0.000',
        netKwh: '0.000',
      });
      expect(body.buckets[3]).toMatchObject({ readings: 1, netKwh: '6.250' });
    });

    it('buckets by day', async () => {
      const { body } = await get('/stats/trends?bucket=day&from=2026-05-27&to=2026-05-29').expect(
        200,
      );

      expect(body.buckets.map((b: { readings: number }) => b.readings)).toEqual([4, 1]);
      expect(body.buckets[0].bucketStart).toBe('2026-05-27T00:00:00.000Z');
    });

    it('starts a week on Monday, as PostgreSQL does', async () => {
      const { body } = await get('/stats/trends?bucket=week&from=2026-05-25&to=2026-06-01').expect(
        200,
      );

      expect(body.buckets).toHaveLength(1);
      expect(body.buckets[0]).toMatchObject({
        bucketStart: '2026-05-25T00:00:00.000Z',
        readings: 5,
      });
    });

    it('aligns a window that starts mid bucket', async () => {
      const { body } = await get(
        '/stats/trends?bucket=day&from=2026-05-27T13:00:00Z&to=2026-05-28T00:00:00Z',
      ).expect(200);

      expect(body.range.from).toBe('2026-05-27T00:00:00.000Z');
      expect(body.buckets[0].readings).toBe(4);
    });
  });

  describe('refusing what it cannot answer', () => {
    it('rejects a malformed bound with 400 and the correlation id', async () => {
      const { body } = await get('/stats/summary?from=yesterday')
        .set('x-correlation-id', 'stats-bad-date')
        .expect(400);

      expect(body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        correlationId: 'stats-bad-date',
        path: '/stats/summary?from=yesterday',
      });
      expect(body.details.join(' ')).toContain('from must be an ISO-8601');
      expect(body).not.toHaveProperty('stack');
    });

    it('rejects a time without an offset, which two readers would read differently', async () => {
      await get('/stats/summary?from=2026-05-27T10:00:00').expect(400);
    });

    it('rejects a backwards window with 422', async () => {
      const { body } = await get('/stats/summary?from=2026-06-01&to=2026-05-01').expect(422);

      expect(body).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: 'from must be earlier than to.',
      });
    });

    it('rejects a window wider than a year', async () => {
      const { body } = await get('/stats/summary?from=2024-01-01&to=2026-01-01').expect(422);

      expect(body.message).toContain('366 days');
    });

    it('rejects a trend that would need too many buckets', async () => {
      const { body } = await get('/stats/trends?bucket=hour&from=2026-01-01&to=2026-06-01').expect(
        422,
      );

      expect(body.message).toContain('744 buckets');
    });

    it.each([
      ['an unknown bucket', '/stats/trends?bucket=fortnight'],
      ['a household id with room for mischief', '/stats/households?householdId=HH-A%3Bdrop'],
      ['a page size nobody needs', '/stats/households?limit=100000'],
      ['a parameter this endpoint does not have', '/stats/summary?householdId=HH-A'],
    ])('rejects %s', async (_case, url) => {
      await get(url).expect(400);
    });
  });

  describe('who may read the statistics', () => {
    // The expected status is in the title and the token deliberately is not.
    it.each([
      ['no token', 401, undefined],
      ['the service token', 403, INTERNAL_TOKEN],
      ['the operator token', 200, OPERATOR_TOKEN],
    ])('answers %s with %i', async (_case, expected, token) => {
      const call = request(app.getHttpServer()).get('/stats/summary');
      if (token) call.set('Authorization', `Bearer ${token}`);
      await call.expect(expected as number);
    });

    it('never echoes the credentials back', async () => {
      const { text } = await get('/stats/summary').expect(200);

      expect(text).not.toContain(OPERATOR_TOKEN);
    });
  });
});
