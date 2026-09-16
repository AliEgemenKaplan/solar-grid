import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from '../src/errors/all-exceptions.filter';
import {
  ApiErrorCode,
  BusinessRuleViolationException,
  IdempotencyConflictException,
} from '../src/errors/api-error';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/trades',
        headers: { 'x-correlation-id': 'cid-under-test' },
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('keeps the code of a coded exception and echoes the correlation id', () => {
    const { status, body } = run(new IdempotencyConflictException());

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toMatchObject({
      statusCode: 409,
      code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      correlationId: 'cid-under-test',
      path: '/trades',
    });
  });

  it('turns validation failures into VALIDATION_FAILED with the field problems as details', () => {
    const { status, body } = run(
      new BadRequestException(['energyKwh must be a decimal string', 'currency must be TRY']),
    );

    expect(status).toBe(400);
    expect(body.code).toBe(ApiErrorCode.VALIDATION_FAILED);
    expect(body.details).toEqual(['energyKwh must be a decimal string', 'currency must be TRY']);
  });

  it('derives a code for framework exceptions from their status', () => {
    expect(run(new NotFoundException()).body.code).toBe(ApiErrorCode.NOT_FOUND);
    expect(run(new BusinessRuleViolationException('no')).body.code).toBe(
      ApiErrorCode.BUSINESS_RULE_VIOLATION,
    );
  });

  it('maps a unique violation to a conflict without naming the constraint', () => {
    const prismaError = Object.assign(
      new Error('Unique constraint failed on the fields: (`idempotencyKey`)'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      },
    );

    const { status, body } = run(prismaError);

    expect(status).toBe(409);
    expect(body.code).toBe(ApiErrorCode.CONFLICT);
    expect(JSON.stringify(body)).not.toContain('idempotencyKey');
  });

  it('hides everything about an unexpected error', () => {
    const leaky = new Error(
      'connect ECONNREFUSED postgresql://postgres:s3cret@db:5432/ledger_db\n    at Pool.connect (pg/lib/pool.js:45:11)',
    );

    const { status, body } = run(leaky);
    const serialised = JSON.stringify(body);

    expect(status).toBe(500);
    expect(body.code).toBe(ApiErrorCode.INTERNAL_ERROR);
    expect(body.message).toBe('The request could not be completed.');
    expect(serialised).not.toContain('s3cret');
    expect(serialised).not.toContain('postgresql://');
    expect(serialised).not.toContain('pool.js');
    expect(body).not.toHaveProperty('stack');
    // Still traceable.
    expect(body.correlationId).toBe('cid-under-test');
  });

  it('gives an error thrown by a RabbitMQ handler back unchanged', () => {
    const failure = new Error('database unavailable');
    const switchToHttp = jest.fn();
    const host = { getType: () => 'rmq', switchToHttp } as unknown as ArgumentsHost;

    expect(() => new AllExceptionsFilter().catch(failure, host)).toThrow(failure);
    expect(switchToHttp).not.toHaveBeenCalled();
  });
});
