import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationLifecycle, HealthController } from '../src/health/health.module';
import {
  databaseCheck,
  DependencyCheck,
  evaluateReadiness,
  rabbitMqCheck,
} from '../src/health/readiness';

const up = (name: string, critical = true): DependencyCheck => ({
  name,
  critical,
  check: async () => undefined,
});

const down = (name: string, critical = true, reason = 'connection refused'): DependencyCheck => ({
  name,
  critical,
  check: async () => {
    throw new Error(reason);
  },
});

describe('evaluateReadiness', () => {
  it('is ready when every dependency answers', async () => {
    const report = await evaluateReadiness('svc', [up('database'), up('rabbitmq')], {
      shuttingDown: false,
    });

    expect(report.status).toBe('ready');
    expect(report.service).toBe('svc');
    expect(report.checks.database).toMatchObject({ status: 'up', critical: true });
    expect(report.checks.rabbitmq.status).toBe('up');
  });

  it('is not ready when a critical dependency is down', async () => {
    const report = await evaluateReadiness('svc', [down('database'), up('rabbitmq')], {
      shuttingDown: false,
    });

    expect(report.status).toBe('not_ready');
    expect(report.checks.database.status).toBe('down');
  });

  it('stays ready when only a non-critical dependency is down, and still reports it', async () => {
    const report = await evaluateReadiness('svc', [up('database'), down('rabbitmq', false)], {
      shuttingDown: false,
    });

    expect(report.status).toBe('ready');
    expect(report.checks.rabbitmq).toMatchObject({ status: 'down', critical: false });
  });

  it('treats a dependency that does not answer in time as down', async () => {
    const hanging: DependencyCheck = {
      name: 'database',
      critical: true,
      check: () => new Promise(() => undefined),
    };

    const report = await evaluateReadiness('svc', [hanging], {
      shuttingDown: false,
      timeoutMs: 20,
    });

    expect(report.status).toBe('not_ready');
    expect(report.checks.database.status).toBe('down');
  });

  it('keeps the reason out of the report and hands it to the caller instead', async () => {
    const failures: string[] = [];
    const report = await evaluateReadiness(
      'svc',
      [down('database', true, 'password authentication failed for user "app"')],
      { shuttingDown: false, onFailure: (name, reason) => failures.push(`${name}: ${reason}`) },
    );

    expect(JSON.stringify(report)).not.toContain('password');
    expect(failures).toEqual(['database: password authentication failed for user "app"']);
  });

  it('hands over a multi-line reason as one line', async () => {
    const failures: string[] = [];
    await evaluateReadiness(
      'svc',
      [
        down(
          'database',
          true,
          '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nServer has closed the connection.',
        ),
      ],
      { shuttingDown: false, onFailure: (_name, reason) => failures.push(reason) },
    );

    expect(failures).toEqual([
      'Invalid `prisma.$queryRaw()` invocation: Server has closed the connection.',
    ]);
  });

  it('reports shutting down without touching any dependency', async () => {
    const check = jest.fn();

    const report = await evaluateReadiness('svc', [{ name: 'database', critical: true, check }], {
      shuttingDown: true,
    });

    expect(report.status).toBe('shutting_down');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('dependency checks', () => {
  it('pings the database through the client it is given', async () => {
    const ping = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    await databaseCheck(ping).check();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('reads the broker connection state', async () => {
    await expect(rabbitMqCheck({ connected: true }, true).check()).resolves.toBeUndefined();
    await expect(rabbitMqCheck({ connected: false }, true).check()).rejects.toThrow(
      'not connected',
    );
  });
});

describe('HealthController', () => {
  function response() {
    const res = { statusCode: 200, status: jest.fn() };
    res.status.mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    return res;
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('answers liveness without asking any dependency', () => {
    const check = jest.fn();
    const controller = new HealthController(
      'svc',
      [{ name: 'database', critical: true, check }],
      new ApplicationLifecycle(),
    );

    expect(controller.live()).toMatchObject({ status: 'ok', service: 'svc' });
    expect(controller.check()).toMatchObject({ status: 'ok', service: 'svc' });
    expect(check).not.toHaveBeenCalled();
  });

  it('answers readiness with 200 or 503', async () => {
    let databaseUp = true;
    const controller = new HealthController(
      'svc',
      [
        {
          name: 'database',
          critical: true,
          check: async () => {
            if (!databaseUp) throw new Error('down');
          },
        },
      ],
      new ApplicationLifecycle(),
    );

    const healthy = response();
    await controller.ready(healthy as unknown as Response);
    expect(healthy.statusCode).toBe(200);

    databaseUp = false;
    const unhealthy = response();
    const report = await controller.ready(unhealthy as unknown as Response);
    expect(unhealthy.statusCode).toBe(503);
    expect(report.status).toBe('not_ready');
  });

  it('turns unready as soon as shutdown begins', async () => {
    const lifecycle = new ApplicationLifecycle();
    const controller = new HealthController('svc', [up('database')], lifecycle);

    lifecycle.onModuleDestroy();
    const res = response();
    const report = await controller.ready(res as unknown as Response);

    expect(res.statusCode).toBe(503);
    expect(report.status).toBe('shutting_down');
  });
});
