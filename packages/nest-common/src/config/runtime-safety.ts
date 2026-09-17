import { Logger } from '@nestjs/common';

/**
 * Raised at startup, in production, when the configuration is not fit to run
 * with. It names what is wrong and never the value that is wrong.
 */
export class UnsafeConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Refusing to start with an unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'UnsafeConfigurationError';
  }
}

/** Passwords shorter than this in a connection URL are treated as defaults. */
export const MINIMUM_PASSWORD_LENGTH = 16;

/** Values people leave in place: image defaults, placeholders, the obvious. */
const WELL_KNOWN_PASSWORDS = new Set([
  'postgres',
  'guest',
  'password',
  'admin',
  'root',
  'secret',
  'test',
  'changeme',
  'change-me',
]);

/**
 * Problems with the credentials inside a connection URL - a default or
 * placeholder password, or none at all. Only the variable name is reported.
 */
export function connectionUrlProblems(name: string, url: string | undefined): string[] {
  if (!url) return [];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [`${name} is not a valid URL.`];
  }

  const password = decodeURIComponent(parsed.password);
  if (password.length === 0) return [`${name} has no password.`];
  if (WELL_KNOWN_PASSWORDS.has(password.toLowerCase())) {
    return [`${name} uses a default or placeholder password.`];
  }
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return [`${name} uses a password shorter than ${MINIMUM_PASSWORD_LENGTH} characters.`];
  }
  return [];
}

/**
 * In production, problems stop the service. Anywhere else they are logged and
 * the service starts, so a laptop does not need production secrets.
 */
export function enforceOrWarn(
  problems: string[],
  environment: string | undefined,
  logger: Pick<Logger, 'warn'>,
): void {
  if (problems.length === 0) return;
  if (environment === 'production') throw new UnsafeConfigurationError(problems);
  for (const problem of problems) logger.warn(problem);
}

export interface DatabaseRoleFacts {
  user: string;
  superuser: boolean;
  ownsDatabase: boolean;
  ownsTables: boolean;
}

/**
 * What the connected role is allowed to be. A superuser, or the owner of the
 * database or of its tables, can alter, drop or read anything regardless of
 * grants - exactly what a runtime role must not be able to do.
 */
export const DATABASE_ROLE_QUERY = `
  SELECT current_user AS "user",
         r.rolsuper AS "superuser",
         d.datdba = r.oid AS "ownsDatabase",
         EXISTS (
           SELECT 1 FROM pg_tables t
           WHERE t.schemaname = 'public' AND t.tableowner = current_user
         ) AS "ownsTables"
  FROM pg_roles r
  JOIN pg_database d ON d.datname = current_database()
  WHERE r.rolname = current_user`;

export function databaseRoleProblems(facts: DatabaseRoleFacts): string[] {
  const problems: string[] = [];
  if (facts.superuser) {
    problems.push(`The database role "${facts.user}" is a superuser; connect as the runtime role.`);
  }
  if (facts.ownsDatabase) {
    problems.push(
      `The database role "${facts.user}" owns the database; connect as the runtime role.`,
    );
  }
  if (facts.ownsTables) {
    problems.push(`The database role "${facts.user}" owns tables; connect as the runtime role.`);
  }
  return problems;
}

/**
 * Checks, right after connecting, that the service is not running as a role
 * that could do more than its grants allow.
 */
export async function verifyRuntimeDatabaseRole(
  query: (sql: string) => Promise<DatabaseRoleFacts[]>,
  environment: string | undefined = process.env.NODE_ENV,
  logger: Pick<Logger, 'warn'> = new Logger('Database'),
): Promise<void> {
  const [facts] = await query(DATABASE_ROLE_QUERY);
  if (!facts) return;
  enforceOrWarn(databaseRoleProblems(facts), environment, logger);
}
