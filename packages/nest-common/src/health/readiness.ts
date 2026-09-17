/**
 * Something a service needs before it can do useful work: its database, the
 * broker it consumes from. A check resolves when the dependency answers and
 * rejects when it does not.
 */
export interface DependencyCheck {
  name: string;
  /**
   * A critical dependency makes the service not ready when it is down. A
   * non-critical one is reported but does not: smart-meter keeps accepting
   * readings while the broker is away, because its outbox holds the events.
   */
  critical: boolean;
  check(): Promise<void>;
}

export type DependencyStatus = 'up' | 'down';

export interface DependencyReport {
  status: DependencyStatus;
  critical: boolean;
  durationMs: number;
}

export type ReadinessStatus = 'ready' | 'not_ready' | 'shutting_down';

export interface ReadinessReport {
  status: ReadinessStatus;
  service: string;
  timestamp: string;
  checks: Record<string, DependencyReport>;
}

/** A dependency slower than this is as good as down for a probe. */
export const READINESS_CHECK_TIMEOUT_MS = 2000;

export interface ReadinessOptions {
  shuttingDown: boolean;
  timeoutMs?: number;
  /** Told the reason a check failed; the report itself never carries it. */
  onFailure?: (name: string, reason: string) => void;
}

/**
 * Runs every check in parallel, each under a deadline, and decides whether
 * the service is ready.
 *
 * A service that is shutting down is never ready, and is not asked to touch
 * its dependencies to find that out.
 */
export async function evaluateReadiness(
  service: string,
  checks: DependencyCheck[],
  options: ReadinessOptions,
): Promise<ReadinessReport> {
  const timestamp = new Date().toISOString();
  if (options.shuttingDown) {
    return { status: 'shutting_down', service, timestamp, checks: {} };
  }

  const timeoutMs = options.timeoutMs ?? READINESS_CHECK_TIMEOUT_MS;
  const results = await Promise.all(
    checks.map(async (dependency) => {
      const started = Date.now();
      try {
        await withTimeout(dependency.check(), timeoutMs, dependency.name);
        return [dependency, 'up' as const, Date.now() - started] as const;
      } catch (err) {
        options.onFailure?.(dependency.name, describe(err));
        return [dependency, 'down' as const, Date.now() - started] as const;
      }
    }),
  );

  const report: Record<string, DependencyReport> = {};
  let ready = true;
  for (const [dependency, status, durationMs] of results) {
    report[dependency.name] = { status, critical: dependency.critical, durationMs };
    if (status === 'down' && dependency.critical) ready = false;
  }

  return { status: ready ? 'ready' : 'not_ready', service, timestamp, checks: report };
}

/**
 * `SELECT 1` through whatever client the service uses. Proves the pool can
 * hand out a connection and the server answers, which is what a request needs.
 */
export function databaseCheck(ping: () => Promise<unknown>): DependencyCheck {
  return {
    name: 'database',
    critical: true,
    check: async () => {
      await ping();
    },
  };
}

/**
 * The broker connection as the client library sees it. The library reconnects
 * on its own, so this turns from down to up without anyone intervening.
 */
export function rabbitMqCheck(
  connection: { readonly connected: boolean },
  critical: boolean,
): DependencyCheck {
  return {
    name: 'rabbitmq',
    critical,
    check: async () => {
      if (!connection.connected) throw new Error('not connected to the broker');
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name} did not answer within ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * One line, whatever the client produced: Prisma's messages span several
 * lines and start with a blank one, which splits a log entry in two.
 */
function describe(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : String(err);
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 0 ? oneLine : 'unknown error';
}
