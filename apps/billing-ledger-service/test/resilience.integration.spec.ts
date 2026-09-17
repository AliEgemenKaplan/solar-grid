import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpApp, MetricsRegistry, StructuredLogger } from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { RuntimeDatabase, startRuntimeDatabase } from './support/runtime-database';
import {
  freePort,
  parseLogLines,
  startContainer,
  stopContainer,
  waitUntil,
} from './support/outages';

jest.setTimeout(300_000);

const INTERNAL_TOKEN = 'resilience-internal-token-0123456789abcdef';
const ORIGINAL_ENV = { ...process.env };

let sequence = 0;
function trade(overrides: Record<string, unknown> = {}) {
  sequence++;
  const id = `TRD-RES-${sequence}`;
  return {
    tradeId: id,
    sellerHouseholdId: 'HH-RES-SELLER',
    buyerHouseholdId: 'HH-RES-BUYER',
    energyKwh: '4.000',
    pricePerKwh: '4.0000',
    totalAmount: '16.00',
    currency: 'TRY',
    idempotencyKey: id,
    correlationId: `cid-res-${sequence}`,
    completedAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

describe('billing when its database goes away', () => {
  let database: RuntimeDatabase;
  let owner: PrismaClient;
  let app: INestApplication;
  const lines: string[] = [];

  beforeAll(async () => {
    database = await startRuntimeDatabase({ hostPort: await freePort() });
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DATABASE_URL: database.runtimeUrl,
      INTERNAL_API_TOKEN: INTERNAL_TOKEN,
      RATE_LIMIT_ENABLED: 'false',
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({
      logger: new StructuredLogger({
        service: 'billing-ledger-service',
        write: (line) => lines.push(line),
      }),
    });
    configureHttpApp(app, { title: 'billing', description: 'test', tags: [], credentials: [] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/trades')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .set('x-correlation-id', (body as { correlationId: string }).correlationId)
      .send(body);

  it('stays alive, reports not ready, refuses safely, and recovers with the ledger intact', async () => {
    const before = trade();
    await post(before).expect(201);

    stopContainer(database.container);
    try {
      // Liveness is about the process, which is fine.
      expect((await request(app.getHttpServer()).get('/health/live')).status).toBe(200);

      const ready = await request(app.getHttpServer()).get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.checks.database.status).toBe('down');

      const during = trade();
      const refused = await post(during);
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({
        code: 'DOWNSTREAM_UNAVAILABLE',
        correlationId: during.correlationId,
      });
      // Nothing about the inside: not the host, not the role, not the error.
      const body = JSON.stringify(refused.body);
      expect(body).not.toMatch(/solargrid_app|5432|prisma|postgres|stack/i);

      const balance = await request(app.getHttpServer()).get('/balances/HH-RES-SELLER');
      expect(balance.status).toBe(503);

      // The operator gets the detail the client did not.
      const logged = parseLogLines(lines).find(
        (entry) =>
          entry.event === 'http.request.failed' && entry.correlationId === during.correlationId,
      );
      expect(logged).toMatchObject({ dependency: 'database', statusCode: 503, level: 'error' });
      expect(
        parseLogLines(lines).some(
          (entry) => entry.event === 'readiness.changed' && entry.status === 'down',
        ),
      ).toBe(true);

      const metrics = await app.get(MetricsRegistry).render();
      expect(metrics).toMatch(
        /solargrid_dependency_failures_total\{dependency="database"[^}]*\} [1-9]/,
      );
      expect(metrics).toMatch(/solargrid_dependency_up\{dependency="database"[^}]*\} 0/);

      // The refused trade can be sent again once the database is back.
      startContainer(database.container);
      await waitUntil(
        async () => (await request(app.getHttpServer()).get('/health/ready')).status === 200,
        'billing to be ready again',
      );

      await post(during).expect(201);
      await post(before).expect(200);
    } finally {
      startContainer(database.container);
    }

    // Two trades, each exactly once, each with a credit and a debit, and the
    // balances equal to what the ledger says.
    expect(await owner.completedTrade.count()).toBe(2);
    expect(await owner.ledgerEntry.count()).toBe(4);
    for (const householdId of ['HH-RES-SELLER', 'HH-RES-BUYER']) {
      const entries = await owner.ledgerEntry.findMany({ where: { householdId } });
      const fromLedger = entries.reduce(
        (sum, entry) =>
          sum + (entry.entryType === 'CREDIT' ? 1 : -1) * Number(entry.amount.toFixed(2)),
        0,
      );
      const balance = await owner.householdBalance.findUniqueOrThrow({ where: { householdId } });
      expect(Number(balance.balance.toFixed(2))).toBe(fromLedger);
    }
    expect(
      parseLogLines(lines).some(
        (entry) => entry.event === 'readiness.changed' && entry.status === 'up',
      ),
    ).toBe(true);
  });
});
