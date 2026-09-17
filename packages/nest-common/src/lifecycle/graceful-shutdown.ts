import { Logger } from '@nestjs/common';

/** Below Docker's default stop grace period plus margin; compose allows 30s. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export interface ClosableApplication {
  close(): Promise<void>;
}

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  /** Replaced in tests; the real one ends the process. */
  exit?: (code: number) => void;
  logger?: Pick<Logger, 'log' | 'warn' | 'error'>;
}

export interface GracefulShutdown {
  /** What a signal triggers; exposed so tests can drive it directly. */
  shutdown(signal: string): Promise<void>;
  /** Removes the signal handlers again. */
  dispose(): void;
}

/**
 * Turns SIGTERM and SIGINT into an orderly `app.close()`.
 *
 * Nest's close runs the shutdown hooks in a fixed order, and the services use
 * that order deliberately:
 *
 * 1. onModuleDestroy - readiness turns 503, so nothing new is routed here
 * 2. beforeApplicationShutdown - consumers are cancelled and the outbox stops,
 *    each waiting for the message or publish it is in the middle of
 * 3. the HTTP server closes, letting requests in flight finish
 * 4. onApplicationShutdown - the broker connection and the database pool close
 *
 * If that has not finished before the deadline the process exits anyway.
 * Nothing is lost by that: a message that was not acknowledged is redelivered,
 * an outbox row that was not marked is published again, and a trade that was
 * reserved but not confirmed is settled on the next run.
 */
export function installGracefulShutdown(
  app: ClosableApplication,
  options: GracefulShutdownOptions = {},
): GracefulShutdown {
  const logger = options.logger ?? new Logger('Shutdown');
  const timeoutMs = options.timeoutMs ?? shutdownTimeoutFromEnv();
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let inProgress = false;

  async function shutdown(signal: string): Promise<void> {
    if (inProgress) {
      // A second Ctrl+C means the person at the terminal does not want to wait.
      logger.warn({
        event: 'shutdown.forced',
        message: `Received ${signal} again during shutdown; exiting immediately`,
        signal,
      });
      exit(1);
      return;
    }
    inProgress = true;

    const started = Date.now();
    logger.log({
      event: 'shutdown.started',
      message: `Received ${signal}; shutting down`,
      signal,
      deadlineMs: timeoutMs,
    });

    const deadline = setTimeout(() => {
      logger.error({
        event: 'shutdown.timed_out',
        message: `Shutdown did not finish within ${timeoutMs}ms; exiting without waiting further`,
        deadlineMs: timeoutMs,
      });
      exit(1);
    }, timeoutMs);
    deadline.unref();

    try {
      await app.close();
      clearTimeout(deadline);
      logger.log({
        event: 'shutdown.completed',
        message: 'Shutdown complete',
        durationMs: Date.now() - started,
      });
      exit(0);
    } catch (err) {
      clearTimeout(deadline);
      logger.error({
        event: 'shutdown.failed',
        message: `Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      });
      exit(1);
    }
  }

  const handler = (signal: NodeJS.Signals) => void shutdown(signal);
  for (const signal of signals) process.on(signal, handler);

  return {
    shutdown,
    dispose: () => {
      for (const signal of signals) process.off(signal, handler);
    },
  };
}

function shutdownTimeoutFromEnv(): number {
  const parsed = Number(process.env.SHUTDOWN_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}
