import {
  connectionUrlProblems,
  databaseRoleProblems,
  enforceOrWarn,
  UnsafeConfigurationError,
  verifyRuntimeDatabaseRole,
} from '../src/config/runtime-safety';

const STRONG = '4f9c2d7e8a1b3c5d6e7f8091a2b3c4d5';

describe('connectionUrlProblems', () => {
  it('accepts a long random password', () => {
    expect(
      connectionUrlProblems(
        'DATABASE_URL',
        `postgresql://solargrid_app:${STRONG}@db:5432/ledger_db`,
      ),
    ).toEqual([]);
  });

  it.each([
    ['the image default', 'postgresql://postgres:postgres@db:5432/ledger_db'],
    ['the broker default', 'amqp://guest:guest@rabbitmq:5672'],
    ['a placeholder', 'postgresql://app:change-me@db:5432/ledger_db'],
    ['a short password', 'postgresql://app:hunter22@db:5432/ledger_db'],
    ['no password', 'postgresql://app@db:5432/ledger_db'],
  ])('flags %s', (_case, url) => {
    expect(connectionUrlProblems('DATABASE_URL', url)).toHaveLength(1);
  });

  it('never repeats the password it objects to', () => {
    const [problem] = connectionUrlProblems(
      'RABBITMQ_URL',
      'amqp://solargrid:hunter22@rabbitmq:5672',
    );
    expect(problem).toContain('RABBITMQ_URL');
    expect(problem).not.toContain('hunter22');
  });

  it('ignores a variable that is not set', () => {
    expect(connectionUrlProblems('RABBITMQ_URL', undefined)).toEqual([]);
  });

  it('reports a malformed URL without echoing it', () => {
    const [problem] = connectionUrlProblems('DATABASE_URL', 'not a url with s3cret');
    expect(problem).toBe('DATABASE_URL is not a valid URL.');
  });
});

describe('enforceOrWarn', () => {
  it('stops a production service and lists every problem', () => {
    const logger = { warn: jest.fn() };

    expect(() => enforceOrWarn(['first', 'second'], 'production', logger)).toThrow(
      UnsafeConfigurationError,
    );
    try {
      enforceOrWarn(['first', 'second'], 'production', logger);
    } catch (err) {
      expect((err as UnsafeConfigurationError).problems).toEqual(['first', 'second']);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('only warns outside production', () => {
    const logger = { warn: jest.fn() };

    enforceOrWarn(['first'], 'development', logger);
    enforceOrWarn(['second'], undefined, logger);

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is nothing wrong', () => {
    expect(() => enforceOrWarn([], 'production', { warn: jest.fn() })).not.toThrow();
  });
});

describe('runtime database role', () => {
  const runtimeRole = {
    user: 'solargrid_app',
    superuser: false,
    ownsDatabase: false,
    ownsTables: false,
  };

  it('accepts a role that owns nothing', () => {
    expect(databaseRoleProblems(runtimeRole)).toEqual([]);
  });

  it('rejects a superuser, the database owner and a table owner', () => {
    expect(
      databaseRoleProblems({ ...runtimeRole, user: 'postgres', superuser: true }),
    ).toHaveLength(1);
    expect(databaseRoleProblems({ ...runtimeRole, ownsDatabase: true })).toHaveLength(1);
    expect(databaseRoleProblems({ ...runtimeRole, ownsTables: true })).toHaveLength(1);
  });

  it('refuses to start in production as the owner', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([
        { ...runtimeRole, user: 'postgres', superuser: true, ownsDatabase: true },
      ]);

    await expect(
      verifyRuntimeDatabaseRole(query, 'production', { warn: jest.fn() }),
    ).rejects.toThrow(/superuser/);
  });

  it('warns in development and carries on', async () => {
    const logger = { warn: jest.fn() };
    const query = jest.fn().mockResolvedValue([{ ...runtimeRole, superuser: true }]);

    await expect(verifyRuntimeDatabaseRole(query, 'development', logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
