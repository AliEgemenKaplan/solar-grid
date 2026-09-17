/**
 * Prisma error codes that mean the database could not be reached or stopped
 * answering, rather than that the query itself was wrong:
 *
 * - P1001 can't reach the database server
 * - P1002 the server was reached but timed out
 * - P1008 the operation timed out
 * - P1017 the server closed the connection
 * - P2024 timed out waiting for a connection from the pool
 */
const UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** Wording used by errors that carry no code for the same situations. */
const UNAVAILABLE_MESSAGE =
  /can't reach database server|server has closed the connection|connection refused|econnrefused|timed out fetching a new connection|connection terminated/i;

/**
 * True when an error means the database is unavailable - something to retry
 * later and to answer with 503 - rather than a bug or a rejected write.
 *
 * Recognised by shape: every service generates its own Prisma client, so
 * there is no single error class to check against.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };

  if (name === 'PrismaClientInitializationError') return true;
  if (typeof name !== 'string' || !name.startsWith('PrismaClient')) return false;
  if (typeof code === 'string' && UNAVAILABLE_CODES.has(code)) return true;
  return typeof message === 'string' && UNAVAILABLE_MESSAGE.test(message);
}
