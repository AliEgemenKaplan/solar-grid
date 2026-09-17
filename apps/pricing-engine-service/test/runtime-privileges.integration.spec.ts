import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  configureHttpApp,
  DATABASE_ROLE_QUERY,
  DatabaseRoleFacts,
  UnsafeConfigurationError,
} from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { PricesService } from '../src/prices/prices.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  RUNTIME_ROLE,
  RuntimeDatabase,
  SCHEMA_CHANGES,
  startRuntimeDatabase,
  TABLES_WITHOUT_RUNTIME_GRANT,
} from './support/runtime-database';

jest.setTimeout(300_000);

const ORIGINAL_ENV = { ...process.env };

/** Pricing as it runs in Docker: production mode. Not yet initialised. */
async function createProductionApp(databaseUrl: string): Promise<INestApplication> {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    OPERATOR_API_TOKEN: 'privileges-operator-token-0123456789abcdef',
    RATE_LIMIT_ENABLED: 'false',
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app, {
    title: 'Pricing Engine Service',
    description: 'test',
    tags: [],
    credentials: ['operator'],
  });
  return app;
}

describe('pricing runtime database privileges', () => {
  let database: RuntimeDatabase;
  let runtime: PrismaClient;
  let owner: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    runtime = new PrismaClient({ datasourceUrl: database.runtimeUrl });
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });
    // Starting inserts the default pricing rule, as the runtime role.
    app = await createProductionApp(database.runtimeUrl);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await runtime?.$disconnect();
    await owner?.$disconnect();
    await database?.container.stop();
    process.env = ORIGINAL_ENV;
  });

  it('seeds its rule, prices and keeps history as the runtime role', async () => {
    const prices = app.get(PricesService);

    expect((await prices.getCurrentPrice()).pricePerKwh).toMatch(/^\d+\.\d{4}$/);
    await prices.recalculate({ totalSupplyKwh: 50, totalDemandKwh: 40 });
    const history = await prices.getPriceHistory({ page: 1, limit: 10 });

    expect(history.total).toBe(1);
    expect(await owner.pricingRule.count()).toBe(1);
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
    ['rewrite a pricing rule', `UPDATE pricing_rules SET "basePrice" = 0`],
    ['rewrite price history', `UPDATE price_snapshots SET "calculatedPrice" = 0`],
    ['delete price history', `DELETE FROM price_snapshots`],
    ['drop the rules', `DROP TABLE pricing_rules`],
    ...SCHEMA_CHANGES.map((sql) => [sql, sql]),
  ])('cannot %s', async (_what, sql) => {
    await expect(runtime.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it('can read every table the migrations created', async () => {
    expect(await owner.$queryRawUnsafe(TABLES_WITHOUT_RUNTIME_GRANT)).toEqual([]);
  });

  it('refuses to start in production as the database owner', async () => {
    const asOwner = await createProductionApp(database.ownerUrl);
    try {
      await expect(asOwner.init()).rejects.toThrow(UnsafeConfigurationError);
    } finally {
      await asOwner.get(PrismaService).$disconnect();
    }
  });
});
