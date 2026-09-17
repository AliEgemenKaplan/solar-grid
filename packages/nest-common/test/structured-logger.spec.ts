import { Logger } from '@nestjs/common';
import {
  createServiceLogger,
  scrubCredentials,
  secretsFrom,
  StructuredLogger,
} from '../src/logging/structured-logger';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function capture(options: Partial<ConstructorParameters<typeof StructuredLogger>[0]> = {}) {
  const lines: string[] = [];
  const logger = new StructuredLogger({
    service: 'billing-ledger-service',
    now: () => NOW,
    write: (line) => lines.push(line),
    ...options,
  });
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

describe('StructuredLogger', () => {
  it('writes one JSON object per line with the standard fields', () => {
    const { logger, entries } = capture();

    logger.log(
      {
        event: 'trade.recorded',
        message: 'Trade recorded',
        correlationId: 'cid-1',
        tradeId: 'TRD-1',
      },
      'TradesService',
    );

    expect(entries()).toEqual([
      {
        timestamp: '2026-09-18T10:00:00.000Z',
        level: 'info',
        service: 'billing-ledger-service',
        context: 'TradesService',
        event: 'trade.recorded',
        message: 'Trade recorded',
        correlationId: 'cid-1',
        tradeId: 'TRD-1',
      },
    ]);
  });

  it("keeps Nest's own string logs, with their context", () => {
    const { logger, entries } = capture();

    logger.log('Mapped {/trades, POST} route', 'RouterExplorer');

    expect(entries()[0]).toMatchObject({
      level: 'info',
      context: 'RouterExplorer',
      message: 'Mapped {/trades, POST} route',
    });
    expect(entries()[0]).not.toHaveProperty('event');
  });

  it('attaches a stack trace passed the way Nest passes one', () => {
    const { logger, entries } = capture();
    const failure = new Error('boom');

    logger.error({ event: 'http.request.failed', message: 'failed' }, failure.stack, 'Filter');

    const entry = entries()[0];
    expect(entry.context).toBe('Filter');
    expect((entry.error as { stack: string }).stack).toContain('Error: boom');
  });

  it('describes an error object with its name, message and code', () => {
    const { logger, entries } = capture();
    const failure = Object.assign(new Error('connection refused'), { code: 'P1001' });

    logger.error({ event: 'readiness.changed', error: failure });

    expect(entries()[0].error).toMatchObject({
      name: 'Error',
      message: 'connection refused',
      code: 'P1001',
    });
  });

  it('honours the minimum level', () => {
    const { logger, entries } = capture({ level: 'warn' });

    logger.log('not written');
    logger.debug('not written');
    logger.warn('written');
    logger.error('written');

    expect(entries().map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('writes readable lines in pretty format', () => {
    const { logger, lines } = capture({ format: 'pretty' });

    logger.log({ event: 'trade.settled', message: 'Trade settled', tradeId: 'TRD-1' }, 'Matching');

    expect(lines[0]).toBe(
      '2026-09-18T10:00:00.000Z INFO  [billing-ledger-service/Matching] trade.settled Trade settled tradeId=TRD-1',
    );
  });

  describe('never leaks a secret', () => {
    it('redacts fields named like credentials', () => {
      const { logger, lines } = capture();

      logger.log({
        event: 'debug.headers',
        authorization: 'Bearer abc.def',
        password: 'hunter2hunter2',
        nested: { apiKey: 'k-123', internalToken: 'x' },
      });

      expect(lines[0]).not.toMatch(/abc\.def|hunter2|k-123/);
      expect(JSON.parse(lines[0])).toMatchObject({
        authorization: '[REDACTED]',
        password: '[REDACTED]',
        nested: { apiKey: '[REDACTED]', internalToken: '[REDACTED]' },
      });
    });

    it('removes configured secret values wherever they appear', () => {
      const secret = 'f3c9a1b27d5e4c6a8b0d1e2f3a4b5c6d';
      const { logger, lines } = capture({ secrets: [secret] });

      logger.error(`request failed while sending ${secret} to billing`);
      logger.log({ event: 'x', detail: { value: secret } });

      expect(lines.join('\n')).not.toContain(secret);
    });

    it('removes bearer tokens and passwords inside connection strings from messages', () => {
      const { logger, lines } = capture();

      logger.error(
        'failed: Authorization: Bearer eyJhbGciOi.payload.sig while connecting to postgresql://solargrid_app:s3cretPassw0rd@db:5432/ledger_db',
      );

      expect(lines[0]).not.toMatch(/eyJhbGciOi|s3cretPassw0rd/);
      expect(lines[0]).toContain('postgresql://solargrid_app:[REDACTED]@db:5432/ledger_db');
    });
  });

  describe('cannot break its caller', () => {
    it('survives circular structures and big integers', () => {
      const { logger, entries } = capture();
      const circular: Record<string, unknown> = { name: 'loop' };
      circular.self = circular;

      expect(() =>
        logger.log({ event: 'odd.values', circular, big: BigInt(2) ** BigInt(70) }),
      ).not.toThrow();
      expect(entries()[0]).toMatchObject({
        circular: { name: 'loop', self: '[Circular]' },
        big: '1180591620717411303424',
      });
    });

    it('writes a fallback line when a value refuses to serialise', () => {
      const { logger, entries } = capture();
      const hostile = {
        toJSON() {
          throw new Error('no');
        },
      };

      expect(() => logger.log({ event: 'hostile', hostile })).not.toThrow();
      expect(entries()[0]).toMatchObject({ event: 'log.write_failed', level: 'error' });
    });

    it('does not throw when writing itself fails', () => {
      const logger = new StructuredLogger({
        service: 'svc',
        write: () => {
          throw new Error('stdout closed');
        },
      });

      expect(() => logger.log('anything')).not.toThrow();
    });
  });

  it('is what Nest loggers write through once installed', () => {
    const { logger, entries } = capture();
    Logger.overrideLogger(logger);
    try {
      new Logger('OutboxPublisherService').warn({
        event: 'outbox.publish.failed',
        eventId: 'evt-1',
      });
    } finally {
      Logger.overrideLogger(false);
      Logger.overrideLogger(true);
    }

    expect(entries()[0]).toMatchObject({
      level: 'warn',
      context: 'OutboxPublisherService',
      event: 'outbox.publish.failed',
      eventId: 'evt-1',
    });
  });
});

describe('createServiceLogger', () => {
  it('writes JSON in production and readable lines elsewhere, unless told otherwise', () => {
    const write = (env: NodeJS.ProcessEnv) => {
      const lines: string[] = [];
      const logger = createServiceLogger('svc', env);
      (logger as unknown as { writeLine: (line: string) => void }).writeLine = (line) =>
        lines.push(line);
      logger.log('hello');
      return lines[0];
    };

    expect(write({ NODE_ENV: 'production' })).toMatch(/^\{/);
    expect(write({ NODE_ENV: 'development' })).toMatch(/INFO {2}\[svc\] hello$/);
    expect(write({ NODE_ENV: 'development', LOG_FORMAT: 'json' })).toMatch(/^\{/);
  });

  it('collects tokens, passwords and connection-string passwords as secrets', () => {
    expect(
      secretsFrom({
        OPERATOR_API_TOKEN: 'operator-token-value-0123456789',
        POSTGRES_PASSWORD: 'owner-password',
        DATABASE_URL: 'postgresql://solargrid_app:runtime%40pass@db:5432/x',
        PORT: '3004',
      }),
    ).toEqual(['operator-token-value-0123456789', 'owner-password', 'runtime@pass']);
  });
});

describe('scrubCredentials', () => {
  it('leaves ordinary text alone', () => {
    expect(scrubCredentials('GET /matches?status=COMPLETED 200 in 12ms')).toBe(
      'GET /matches?status=COMPLETED 200 in 12ms',
    );
  });
});
