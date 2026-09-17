import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  configureHttpApp,
  DATABASE_ROLE_QUERY,
  DatabaseRoleFacts,
  UnsafeConfigurationError,
} from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  RUNTIME_ROLE,
  RuntimeDatabase,
  SCHEMA_CHANGES,
  startRuntimeDatabase,
  TABLES_WITHOUT_RUNTIME_GRANT,
} from './support/runtime-database';

jest.setTimeout(300_000);

const INTERNAL_TOKEN = 'privileges-internal-token-0123456789abcdef';
const OPERATOR_TOKEN = 'privileges-operator-token-0123456789abcdef';
const ORIGINAL_ENV = { ...process.env };

/** Billing as it runs in Docker: production mode, runtime role. Not yet initialised. */
async function createProductionApp(databaseUrl: string): Promise<INestApplication> {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    RATE_LIMIT_ENABLED: 'false',
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app, {
    title: 'Billing & Ledger Service',
    description: 'test',
    tags: [],
    credentials: ['internal-service'],
  });
  return app;
}

describe('billing runtime database privileges', () => {
  let database: RuntimeDatabase;
  let runtime: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    runtime = new PrismaClient({ datasourceUrl: database.runtimeUrl });
    await runtime.$connect();
    app = await createProductionApp(database.runtimeUrl);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.$disconnect();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  it('records, replays and reads trades as the runtime role', async () => {
    const trade = {
      tradeId: 'TRD-PRIV-001',
      sellerHouseholdId: 'HH-PRIV-SELLER',
      buyerHouseholdId: 'HH-PRIV-BUYER',
      energyKwh: '4.000',
      pricePerKwh: '4.0000',
      totalAmount: '16.00',
      currency: 'TRY',
      idempotencyKey: 'TRD-PRIV-001',
      correlationId: 'cid-privileges',
      completedAt: '2026-09-17T10:00:00.000Z',
    };
    const post = () =>
      request(app.getHttpServer())
        .post('/trades')
        .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send(trade);

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(200);

    // A second trade moves the same balances again: the UPDATE path.
    const second = await request(app.getHttpServer())
      .post('/trades')
      .set('Authorization', `Bearer ${INTERNAL_TOKEN}`)
      .send({ ...trade, tradeId: 'TRD-PRIV-002', idempotencyKey: 'TRD-PRIV-002' });
    expect(second.status).toBe(201);

    const balance = await request(app.getHttpServer()).get('/balances/HH-PRIV-SELLER');
    expect(balance.body.balance).toBe('32.00');
    const ledger = await request(app.getHttpServer()).get('/ledger/HH-PRIV-BUYER');
    expect(ledger.body.total).toBe(2);
    expect((await request(app.getHttpServer()).get('/trades')).body.total).toBe(2);
    expect((await request(app.getHttpServer()).get('/health/ready')).status).toBe(200);
  });

  it('connects as a role that is neither a superuser nor an owner', async () => {
    const [facts] = await runtime.$queryRawUnsafe<DatabaseRoleFacts[]>(DATABASE_ROLE_QUERY);
    expect(facts).toEqual({
      user: RUNTIME_ROLE,
      superuser: false,
      ownsDatabase: false,
      ownsTables: false,
    });
  });

  it.each([
    ['rewrite a ledger entry', `UPDATE ledger_entries SET amount = 0`],
    ['delete a ledger entry', `DELETE FROM ledger_entries`],
    ['rewrite a recorded trade', `UPDATE completed_trades SET "totalAmount" = 0`],
    ['delete a recorded trade', `DELETE FROM completed_trades`],
    ['forget an idempotency key', `DELETE FROM idempotency_keys`],
    ['wipe the balances', `TRUNCATE household_balances`],
    ['drop the ledger', `DROP TABLE ledger_entries`],
    ...SCHEMA_CHANGES.map((sql) => [sql, sql]),
  ])('cannot %s', async (_what, sql) => {
    await expect(runtime.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it('can read every table the migrations created', async () => {
    const owner = new PrismaClient({ datasourceUrl: database.ownerUrl });
    try {
      expect(await owner.$queryRawUnsafe(TABLES_WITHOUT_RUNTIME_GRANT)).toEqual([]);

      // And the check notices a table that was left out.
      await owner.$executeRawUnsafe(`REVOKE SELECT ON household_balances FROM ${RUNTIME_ROLE}`);
      try {
        expect(await owner.$queryRawUnsafe(TABLES_WITHOUT_RUNTIME_GRANT)).toEqual([
          { tablename: 'household_balances' },
        ]);
      } finally {
        await owner.$executeRawUnsafe(`GRANT SELECT ON household_balances TO ${RUNTIME_ROLE}`);
      }
    } finally {
      await owner.$disconnect();
    }
  });

  it('refuses to start in production as the database owner', async () => {
    const asOwner = await createProductionApp(database.ownerUrl);
    try {
      await expect(asOwner.init()).rejects.toThrow(UnsafeConfigurationError);
    } finally {
      // It connected before it checked who it was connected as.
      await asOwner.get(PrismaService).$disconnect();
    }
  });
});
