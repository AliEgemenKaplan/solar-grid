import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpApp } from '@solar-grid/nest-common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';

jest.setTimeout(300_000);

const OPERATOR_TOKEN = 'test-operator-token-0123456789abcdef0123';
const INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef0123';
const METRICS_TOKEN = 'test-metrics-token-0123456789abcdef01234';

const ORIGINAL_ENV = { ...process.env };

/**
 * Boots the real billing application - real modules, real guards, the real
 * validation pipe and error filter - over HTTP, with whatever environment the
 * test is about.
 */
async function startApp(databaseUrl: string, env: Record<string, string> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    METRICS_TOKEN,
    RATE_LIMIT_ENABLED: 'false',
    ...env,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app, {
    title: 'Billing & Ledger Service',
    description: 'test',
    tags: ['Trades'],
    credentials: ['internal-service'],
  });
  await app.init();
  return app;
}

let sequence = 0;
function trade(overrides: Record<string, unknown> = {}) {
  sequence++;
  const id = `TRD-API-${Date.now()}-${sequence}`;
  return {
    tradeId: id,
    sellerHouseholdId: 'HH-API-SELLER',
    buyerHouseholdId: 'HH-API-BUYER',
    energyKwh: '4.000',
    pricePerKwh: '4.0000',
    totalAmount: '16.00',
    currency: 'TRY',
    idempotencyKey: id,
    correlationId: `cid-api-${sequence}`,
    completedAt: '2026-05-27T10:10:00.000Z',
    ...overrides,
  };
}

describe('billing HTTP API', () => {
  let database: RuntimeDatabase;
  let app: INestApplication;
  let databaseUrl: string;

  beforeAll(async () => {
    // As in production: the service connects as the runtime role, not as the
    // owner that ran the migrations.
    database = await startRuntimeDatabase();
    databaseUrl = database.runtimeUrl;
    app = await startApp(databaseUrl);
  });

  afterAll(async () => {
    await app?.close();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  const post = (body: object, token?: string) => {
    const req = request(app.getHttpServer()).post('/trades').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('authentication and authorization', () => {
    it('refuses a request with no token', async () => {
      const response = await post(trade()).set('x-correlation-id', 'cid-no-token');

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        correlationId: 'cid-no-token',
        path: '/trades',
      });
    });

    it('refuses a token nobody recognises', async () => {
      const response = await post(trade(), 'not-a-real-token');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('refuses a malformed authorization header', async () => {
      const response = await request(app.getHttpServer())
        .post('/trades')
        .set('Authorization', `Basic ${INTERNAL_TOKEN}`)
        .send(trade());
      expect(response.status).toBe(401);
    });

    it('forbids a valid token that belongs to a different role', async () => {
      const response = await post(trade(), OPERATOR_TOKEN);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('allows the internal service token', async () => {
      const response = await post(trade(), INTERNAL_TOKEN);
      expect(response.status).toBe(201);
    });

    it('never puts a configured secret in a response', async () => {
      const responses = await Promise.all([
        post(trade(), 'wrong-token'),
        post(trade(), OPERATOR_TOKEN),
        post({}, INTERNAL_TOKEN),
      ]);

      for (const response of responses) {
        const text = JSON.stringify(response.body) + JSON.stringify(response.headers);
        expect(text).not.toContain(OPERATOR_TOKEN);
        expect(text).not.toContain(INTERNAL_TOKEN);
        expect(response.body).not.toHaveProperty('stack');
      }
    });

    it('checks credentials before it looks at the body', async () => {
      // An unauthenticated caller learns nothing about what a valid body is.
      const response = await post({ energyKwh: 'garbage' });
      expect(response.status).toBe(401);
    });
  });

  describe('validation', () => {
    it.each([
      ['energy as a JSON number', { energyKwh: 4 }],
      ['energy that is not a number', { energyKwh: 'NaN' }],
      ['infinite energy', { energyKwh: 'Infinity' }],
      ['negative energy', { energyKwh: '-4.000' }],
      ['energy with more precision than the ledger stores', { energyKwh: '4.0001' }],
      ['an empty price', { pricePerKwh: '' }],
      ['a negative price', { pricePerKwh: '-4.0000' }],
      ['a malformed total', { totalAmount: '16,00' }],
      ['an unsupported currency', { currency: 'USD' }],
      ['a household id with unsafe characters', { sellerHouseholdId: "HH-1'; DROP TABLE" }],
      ['a correlation id that is far too long', { correlationId: 'x'.repeat(200) }],
      ['a completion time that is not a date', { completedAt: 'yesterday' }],
      ['a field the endpoint does not accept', { status: 'COMPLETED' }],
    ])('rejects %s with 400', async (_label, overrides) => {
      const response = await post(trade(overrides), INTERNAL_TOKEN);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(Array.isArray(response.body.details)).toBe(true);
    });

    it('rejects an empty body with 400 and lists every missing field', async () => {
      const response = await post({}, INTERNAL_TOKEN);

      expect(response.status).toBe(400);
      expect(response.body.details.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('business rules and idempotency', () => {
    it('answers a household trading with itself with 422', async () => {
      const response = await post(
        trade({ sellerHouseholdId: 'HH-SAME', buyerHouseholdId: 'HH-SAME' }),
        INTERNAL_TOKEN,
      );

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('answers a total that is not energy times price with 422', async () => {
      const response = await post(trade({ totalAmount: '1.00' }), INTERNAL_TOKEN);

      expect(response.status).toBe(422);
      expect(response.body.details).toEqual(['expected 16.00, received 1.00']);
    });

    it('records once and answers the identical retry with the stored trade', async () => {
      const body = trade();

      const first = await post(body, INTERNAL_TOKEN);
      const second = await post(body, INTERNAL_TOKEN);

      expect(first.status).toBe(201);
      expect(first.body.duplicate).toBe(false);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ duplicate: true, id: first.body.id });

      const prisma = app.get(PrismaService);
      expect(await prisma.ledgerEntry.count({ where: { tradeId: body.tradeId } })).toBe(2);
    });

    it('treats the same trade written differently as the same request', async () => {
      const body = trade();
      await post(body, INTERNAL_TOKEN);

      const rewritten = await post(
        {
          ...body,
          energyKwh: '4',
          pricePerKwh: '4',
          totalAmount: '16',
          completedAt: '2026-05-27T13:10:00.000+03:00',
          correlationId: 'a-different-trace',
        },
        INTERNAL_TOKEN,
      );

      expect(rewritten.status).toBe(200);
      expect(rewritten.body.duplicate).toBe(true);
    });

    it('answers the same key with a different payload with 409 and moves no money', async () => {
      const body = trade();
      await post(body, INTERNAL_TOKEN);

      const conflicting = await post(
        { ...body, energyKwh: '5.000', totalAmount: '20.00' },
        INTERNAL_TOKEN,
      );

      expect(conflicting.status).toBe(409);
      expect(conflicting.body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflicting.body.details).toEqual(
        expect.arrayContaining(['energyKwh differs from the recorded trade']),
      );

      const prisma = app.get(PrismaService);
      const recorded = await prisma.completedTrade.findUniqueOrThrow({
        where: { tradeId: body.tradeId },
      });
      expect(recorded.totalAmount.toFixed(2)).toBe('16.00');
    });

    it('answers a reused trade id under a different key with 409 CONFLICT', async () => {
      const body = trade();
      await post(body, INTERNAL_TOKEN);

      const response = await post(
        { ...body, idempotencyKey: `${body.idempotencyKey}-other` },
        INTERNAL_TOKEN,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });

    it('settles once when the same request arrives twice at the same moment', async () => {
      const body = trade();

      const [a, b] = await Promise.all([post(body, INTERNAL_TOKEN), post(body, INTERNAL_TOKEN)]);

      expect([a.status, b.status].sort()).toEqual([200, 201]);
      const prisma = app.get(PrismaService);
      expect(await prisma.ledgerEntry.count({ where: { tradeId: body.tradeId } })).toBe(2);
    });
  });

  describe('reads, pagination and not found', () => {
    const get = (url: string) => request(app.getHttpServer()).get(url);

    it('returns 404 with the error contract for a trade that does not exist', async () => {
      const response = await get('/trades/TRD-DOES-NOT-EXIST');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: 'NOT_FOUND',
        path: '/trades/TRD-DOES-NOT-EXIST',
      });
    });

    it('rejects a malformed trade id with 400', async () => {
      const response = await get('/trades/TRD%20with%20spaces');
      expect(response.status).toBe(400);
    });

    it('pages with a default size', async () => {
      const response = await get('/trades');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ page: 1, limit: 50 });
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(typeof response.body.total).toBe('number');
    });

    it.each([
      ['a page size above the maximum', '/trades?limit=101'],
      ['an abusive page size', '/trades?limit=999999'],
      ['page zero', '/trades?page=0'],
      ['a negative page', '/trades?page=-1'],
      ['a page size that is not a number', '/trades?limit=abc'],
      ['an unsafe correlation id filter', '/trades?correlationId=%3Cscript%3E'],
      ['an unknown query parameter', '/trades?sort=amount'],
    ])('rejects %s with 400', async (_label, url) => {
      const response = await get(url);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('orders pages deterministically so no row appears twice or goes missing', async () => {
      const household = `HH-PAGES-${Date.now()}`;
      for (let index = 0; index < 5; index++) {
        await post(
          trade({ sellerHouseholdId: household, completedAt: '2026-06-01T00:00:00.000Z' }),
          INTERNAL_TOKEN,
        );
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) => get(`/trades?householdId=${household}&limit=2&page=${page}`)),
      );
      const ids = pages.flatMap((page) => page.body.items.map((item: { id: string }) => item.id));

      expect(pages[0].body.total).toBe(5);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);

      // Asking again returns the same order.
      const again = await get(`/trades?householdId=${household}&limit=2&page=1`);
      expect(again.body.items.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 2));
    });

    it('filters by correlation id', async () => {
      const body = trade({ correlationId: `cid-filter-${Date.now()}` });
      await post(body, INTERNAL_TOKEN);

      const response = await get(`/trades?correlationId=${body.correlationId}`);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].tradeId).toBe(body.tradeId);
    });

    it('pages the ledger and documents amounts as decimal strings', async () => {
      const body = trade({ sellerHouseholdId: `HH-LEDGER-${Date.now()}` });
      await post(body, INTERNAL_TOKEN);

      const response = await get(`/ledger/${body.sellerHouseholdId}?limit=10`);

      expect(response.status).toBe(200);
      expect(response.body.items[0]).toMatchObject({ entryType: 'CREDIT', amount: '16.00' });
    });
  });

  describe('HTTP hardening', () => {
    it('replaces an unusable correlation id instead of echoing it', async () => {
      const response = await request(app.getHttpServer())
        .get('/balances/HH-ANYONE')
        .set('x-correlation-id', 'contains spaces and <tags>');

      expect(response.headers['x-correlation-id']).not.toBe('contains spaces and <tags>');
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('sends security headers and does not advertise the framework', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('does not enable CORS unless origins are configured', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://evil.example');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('metrics', () => {
    const scrape = (token?: string) => {
      const req = request(app.getHttpServer()).get('/metrics');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('serves metrics only to the metrics token', async () => {
      expect((await scrape()).status).toBe(401);
      expect((await scrape(INTERNAL_TOKEN)).status).toBe(403);
      expect((await scrape(OPERATOR_TOKEN)).status).toBe(403);
      expect((await scrape(METRICS_TOKEN)).status).toBe(200);
    });

    it('reports HTTP traffic by route template and settlements by outcome', async () => {
      const recorded = trade();
      await post(recorded, INTERNAL_TOKEN).expect(201);
      await post(recorded, INTERNAL_TOKEN).expect(200);
      await request(app.getHttpServer()).get(`/trades/${recorded.tradeId}`).expect(200);

      const response = await scrape(METRICS_TOKEN);

      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['cache-control']).toBe('no-store');
      const text = response.text;
      const routeLine = text
        .split('\n')
        .find(
          (line) =>
            line.startsWith('solargrid_http_requests_total{') &&
            line.includes('route="/trades/:tradeId"') &&
            line.includes('status="200"') &&
            line.includes('service="billing-ledger-service"'),
        );
      expect(routeLine).toBeDefined();
      expect(text).toMatch(/solargrid_settlements_total\{outcome="recorded"[^}]*\} \d+/);
      expect(text).toMatch(/solargrid_settlements_total\{outcome="replayed"[^}]*\} \d+/);
      // Counts only: no trade ids, no tokens, no correlation ids.
      expect(text).not.toContain(recorded.tradeId);
      expect(text).not.toContain(INTERNAL_TOKEN);
      expect(text).not.toContain(METRICS_TOKEN);
      expect(text).not.toContain(recorded.correlationId);
    });
  });

  /**
   * The operator dashboard's view of the same counters. /metrics stays the
   * scraper's; this is the operator's, and it carries counts, never ids.
   */
  describe('diagnostics', () => {
    const diagnostics = (token?: string) => {
      const req = request(app.getHttpServer()).get('/diagnostics');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('is for the operator only', async () => {
      expect((await diagnostics()).status).toBe(401);
      expect((await diagnostics(INTERNAL_TOKEN)).status).toBe(403);
      expect((await diagnostics(METRICS_TOKEN)).status).toBe(403);
      expect((await diagnostics(OPERATOR_TOKEN)).status).toBe(200);
    });

    it('reports what the service did, as JSON counts without identifiers', async () => {
      const recorded = trade();
      await post(recorded, INTERNAL_TOKEN).expect(201);
      await post(recorded, INTERNAL_TOKEN).expect(200);

      const response = await diagnostics(OPERATOR_TOKEN).expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        service: 'billing-ledger-service',
        countingSince: expect.any(String),
        generatedAt: expect.any(String),
      });
      const settlements = response.body.metrics.find(
        (metric: { name: string }) => metric.name === 'settlements_total',
      );
      const count = (outcome: string) =>
        settlements.series.find(
          (series: { labels: { outcome: string } }) => series.labels.outcome === outcome,
        )?.value;
      expect(count('recorded')).toBeGreaterThanOrEqual(1);
      expect(count('replayed')).toBeGreaterThanOrEqual(1);

      const text = JSON.stringify(response.body);
      expect(text).not.toContain(recorded.tradeId);
      expect(text).not.toContain(recorded.correlationId);
      expect(text).not.toContain(OPERATOR_TOKEN);
      expect(text).not.toContain(INTERNAL_TOKEN);
    });
  });

  describe('environment dependent behaviour', () => {
    it('limits the rate of requests and exempts the internal service', async () => {
      const limited = await startApp(databaseUrl, {
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_MAX: '3',
        RATE_LIMIT_WRITE_MAX: '2',
      });
      try {
        const server = limited.getHttpServer();
        const statuses: number[] = [];
        for (let index = 0; index < 4; index++) {
          statuses.push((await request(server).get('/balances/HH-RATE')).status);
        }
        expect(statuses).toEqual([200, 200, 200, 429]);

        const throttled = await request(server).get('/balances/HH-RATE');
        expect(throttled.body.code).toBe('RATE_LIMITED');

        // Settlement between services is never throttled by public traffic.
        const body = trade();
        const internal: number[] = [];
        for (let index = 0; index < 4; index++) {
          internal.push(
            (
              await request(server)
                .post('/trades')
                .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
                .send(body)
            ).status,
          );
        }
        expect(internal).not.toContain(429);
      } finally {
        await limited.close();
      }
    });

    it('keeps Swagger off in production unless it is explicitly enabled', async () => {
      const production = await startApp(databaseUrl, { NODE_ENV: 'production' });
      try {
        const response = await request(production.getHttpServer()).get('/api');
        expect(response.status).toBe(404);
      } finally {
        await production.close();
      }

      const enabled = await startApp(databaseUrl, {
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
      });
      try {
        const document = await request(enabled.getHttpServer()).get('/api-json');
        expect(document.status).toBe(200);

        // The contract documents money as text, and says who may call what.
        const schema = document.body.components.schemas.CreateTradeDto;
        expect(schema.properties.energyKwh.type).toBe('string');
        expect(schema.properties.totalAmount.type).toBe('string');
        expect(document.body.components.securitySchemes['internal-service']).toMatchObject({
          type: 'http',
          scheme: 'bearer',
        });
        expect(document.body.paths['/trades'].post.security).toEqual([{ 'internal-service': [] }]);
        expect(JSON.stringify(document.body)).not.toContain(INTERNAL_TOKEN);
      } finally {
        await enabled.close();
      }
    });

    it('allows only the configured browser origins', async () => {
      const withCors = await startApp(databaseUrl, {
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      });
      try {
        const allowed = await request(withCors.getHttpServer())
          .get('/health')
          .set('Origin', 'http://localhost:5173');
        const other = await request(withCors.getHttpServer())
          .get('/health')
          .set('Origin', 'http://evil.example');

        expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(other.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await withCors.close();
      }
    });
  });
});
