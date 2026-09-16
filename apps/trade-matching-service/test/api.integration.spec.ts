import { execSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { configureHttpApp, RateLimitModule } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { MatchingModule } from '../src/matching/matching.module';
import { OffersModule } from '../src/offers/offers.module';
import { RequestsModule } from '../src/requests/requests.module';

jest.setTimeout(300_000);

const OPERATOR_TOKEN = 'test-operator-token-0123456789abcdef0123';
const INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef0123';
const ORIGINAL_ENV = { ...process.env };

/**
 * The HTTP side of trade-matching without the RabbitMQ consumer: this suite is
 * about who may call what and what they get back, not about messaging.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    RateLimitModule.forRoot(),
    PrismaModule,
    MatchingModule,
    OffersModule,
    RequestsModule,
  ],
})
class HttpOnlyModule {}

describe('trade-matching HTTP API', () => {
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:15-alpine').start();
    const databaseUrl = postgres.getConnectionUri();
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      OPERATOR_API_TOKEN: OPERATOR_TOKEN,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      RATE_LIMIT_ENABLED: 'false',
      // Nothing listens on port 1, so pricing and billing are both down.
      PRICING_ENGINE_URL: 'http://127.0.0.1:1',
      BILLING_LEDGER_URL: 'http://127.0.0.1:1',
      HTTP_CLIENT_TIMEOUT_MS: '1000',
    };

    const moduleRef = await Test.createTestingModule({ imports: [HttpOnlyModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app, {
      title: 'Trade Matching Service',
      description: 'test',
      tags: ['Matching'],
      credentials: ['operator', 'internal-service'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await postgres?.stop();
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    await prisma.tradeMatch.deleteMany();
    await prisma.sellOffer.deleteMany();
    await prisma.buyRequest.deleteMany();
  });

  async function seedMatchablePair() {
    const offer = await prisma.sellOffer.create({
      data: {
        householdId: 'HH-SELLER',
        sourceEventId: randomUUID(),
        availableKwh: '7.000',
        originalKwh: '7.000',
        status: 'OPEN',
        correlationId: 'cid-seed',
      },
    });
    await prisma.buyRequest.create({
      data: {
        householdId: 'HH-BUYER',
        sourceEventId: randomUUID(),
        requestedKwh: '4.000',
        originalKwh: '4.000',
        status: 'OPEN',
        correlationId: 'cid-seed',
      },
    });
    return offer;
  }

  const run = (token?: string) => {
    const req = request(app.getHttpServer()).post('/matching/run');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('POST /matching/run', () => {
    it('refuses a caller without a token', async () => {
      const response = await run();
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('forbids the internal service token, which is not an operator', async () => {
      const response = await run(INTERNAL_TOKEN);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('lets an operator run matching and answers 200, since nothing is created', async () => {
      // No offers, so pricing is never called and the run completes.
      const response = await run(OPERATOR_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ matched: 0, failed: 0, skipped: 0, pending: 0, settled: 0 });
    });

    it('answers 503 when pricing is down, and leaves the energy untouched', async () => {
      const offer = await seedMatchablePair();

      const response = await run(OPERATOR_TOKEN).set('x-correlation-id', 'cid-pricing-down');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'DOWNSTREAM_UNAVAILABLE',
        correlationId: 'cid-pricing-down',
      });
      // The pricing host and port never reach the client.
      expect(JSON.stringify(response.body)).not.toContain('127.0.0.1');

      // The price is fetched before anything is reserved, so a failed run is
      // free to retry: no trade, and the offer still has all its energy.
      expect(await prisma.tradeMatch.count()).toBe(0);
      const untouched = await prisma.sellOffer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(untouched.availableKwh.toFixed(3)).toBe('7.000');
      expect(untouched.status).toBe('OPEN');
    });
  });

  describe('reads', () => {
    const get = (url: string) => request(app.getHttpServer()).get(url);

    it('pages offers and filters them by status', async () => {
      await seedMatchablePair();

      const response = await get('/offers?status=OPEN&limit=10');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ page: 1, limit: 10, total: 1 });
      expect(response.body.items[0]).toMatchObject({ availableKwh: '7.000', status: 'OPEN' });
    });

    it('filters requests by correlation id', async () => {
      await seedMatchablePair();

      const matching = await get('/requests?correlationId=cid-seed');
      const other = await get('/requests?correlationId=cid-nobody');

      expect(matching.body.total).toBe(1);
      expect(other.body.total).toBe(0);
    });

    it.each([
      ['an unknown status', '/matches?status=SETTLED'],
      ['a status in the wrong case', '/offers?status=open'],
      ['an oversized page', '/requests?limit=500'],
    ])('rejects %s with 400', async (_label, url) => {
      const response = await get(url);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('returns 404 for a trade that does not exist', async () => {
      const response = await get('/matches/TRD-NOT-THERE');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });
  });
});
