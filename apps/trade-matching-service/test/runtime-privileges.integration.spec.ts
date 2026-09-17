import {
  DATABASE_ROLE_QUERY,
  DatabaseRoleFacts,
  UnsafeConfigurationError,
  verifyRuntimeDatabaseRole,
} from '@solar-grid/nest-common';
import { PrismaClient } from '../generated/client';
import {
  RUNTIME_ROLE,
  RuntimeDatabase,
  SCHEMA_CHANGES,
  startRuntimeDatabase,
  TABLES_WITHOUT_RUNTIME_GRANT,
} from './support/runtime-database';

jest.setTimeout(300_000);

/**
 * What the trade-matching runtime role must not be able to do. What it must be
 * able to do is covered by matching.integration.spec.ts, which runs every
 * reserve, bill and confirm scenario as this role.
 */
describe('trade-matching runtime database privileges', () => {
  let database: RuntimeDatabase;
  let runtime: PrismaClient;
  let owner: PrismaClient;

  beforeAll(async () => {
    database = await startRuntimeDatabase();
    runtime = new PrismaClient({ datasourceUrl: database.runtimeUrl });
    owner = new PrismaClient({ datasourceUrl: database.ownerUrl });
  });

  afterAll(async () => {
    await runtime?.$disconnect();
    await owner?.$disconnect();
    await database?.container.stop();
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

  it('can still take the matching lock, which needs no grant', async () => {
    await expect(
      runtime.$transaction((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(42::bigint)`),
    ).resolves.toBeDefined();
  });

  it.each([
    ['delete a trade', `DELETE FROM trade_matches`],
    ['delete an offer', `DELETE FROM sell_offers`],
    ['wipe the requests', `TRUNCATE buy_requests`],
    ['drop the trades', `DROP TABLE trade_matches`],
    ['add a column', `ALTER TABLE trade_matches ADD COLUMN intruder int`],
    ...SCHEMA_CHANGES.map((sql) => [sql, sql]),
  ])('cannot %s', async (_what, sql) => {
    await expect(runtime.$executeRawUnsafe(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it('can read every table the migrations created', async () => {
    expect(await owner.$queryRawUnsafe(TABLES_WITHOUT_RUNTIME_GRANT)).toEqual([]);
  });

  it('refuses the owner role in production', async () => {
    await expect(
      verifyRuntimeDatabaseRole(
        (sql) => owner.$queryRawUnsafe<DatabaseRoleFacts[]>(sql),
        'production',
      ),
    ).rejects.toThrow(UnsafeConfigurationError);
  });
});
