import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpThrottlerGuard } from '../src/http/rate-limit';

function contextOfType(type: string) {
  const switchToHttp = jest.fn(() => {
    throw new Error('not an HTTP request');
  });
  const context = {
    getType: () => type,
    getHandler: () => jest.fn(),
    getClass: () => class Consumer {},
    switchToHttp,
  } as unknown as ExecutionContext;
  return { context, switchToHttp };
}

describe('HttpThrottlerGuard', () => {
  const guard = new HttpThrottlerGuard(
    { throttlers: [{ name: 'default', limit: 1, ttl: 60_000 }] },
    { increment: jest.fn() },
    new Reflector(),
  );

  it('lets a RabbitMQ handler run without looking for a request', async () => {
    const { context, switchToHttp } = contextOfType('rmq');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(switchToHttp).not.toHaveBeenCalled();
  });
});
