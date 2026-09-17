import { execSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export const RUNTIME_ROLE = 'solargrid_app';
const RUNTIME_PASSWORD = 'runtime-role-password-for-tests-0123456789';
const OWNER_PASSWORD = 'owner-password-for-tests-0123456789abcdef';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const CREATE_ROLE_SCRIPT = path.resolve(
  SERVICE_ROOT,
  '..',
  '..',
  'infrastructure',
  'postgres',
  'create-app-role.sh',
);

export interface RuntimeDatabase {
  container: StartedPostgreSqlContainer;
  /** The owner: runs migrations and grants, and nothing else. */
  ownerUrl: string;
  /** What the service connects as. */
  runtimeUrl: string;
}

/**
 * PostgreSQL prepared exactly as docker-compose prepares it: the runtime role
 * created by the same init script, then migrations and runtime grants applied
 * as the owner - the job the migration container does.
 */
export async function startRuntimeDatabase(): Promise<RuntimeDatabase> {
  const container = await new PostgreSqlContainer('postgres:15-alpine')
    .withUsername('solargrid_owner')
    .withPassword(OWNER_PASSWORD)
    .withEnvironment({ APP_DB_PASSWORD: RUNTIME_PASSWORD })
    .withCopyFilesToContainer([
      {
        source: CREATE_ROLE_SCRIPT,
        target: '/docker-entrypoint-initdb.d/10-create-app-role.sh',
        mode: 0o755,
      },
    ])
    .start();

  const ownerUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: ownerUrl };
  execSync('pnpm exec prisma migrate deploy', { cwd: SERVICE_ROOT, env, stdio: 'ignore' });
  execSync(
    'pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/runtime-grants.sql',
    { cwd: SERVICE_ROOT, env, stdio: 'ignore' },
  );

  const runtime = new URL(ownerUrl);
  runtime.username = RUNTIME_ROLE;
  runtime.password = RUNTIME_PASSWORD;
  return { container, ownerUrl, runtimeUrl: runtime.toString() };
}

/** Tables the migrations created that the runtime role cannot even read. */
export const TABLES_WITHOUT_RUNTIME_GRANT = `
  SELECT c.relname AS tablename
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname <> '_prisma_migrations'
    -- By oid: a name built from every catalog row could be evaluated before
    -- the schema filter and name a table that does not exist.
    AND NOT has_table_privilege('${RUNTIME_ROLE}', c.oid, 'SELECT')
  ORDER BY c.relname`;

/** Statements no runtime role should be able to run, whatever the service. */
export const SCHEMA_CHANGES = [
  'CREATE TABLE intruder (id int)',
  'SELECT * FROM _prisma_migrations',
];
