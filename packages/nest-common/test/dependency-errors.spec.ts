import { isDatabaseUnavailable } from '../src/errors/dependency-errors';

const prismaError = (name: string, fields: Record<string, unknown>) =>
  Object.assign(new Error(String(fields.message ?? '')), { name, ...fields });

describe('isDatabaseUnavailable', () => {
  it.each([
    ['the client could not start', prismaError('PrismaClientInitializationError', {})],
    [
      'the server cannot be reached',
      prismaError('PrismaClientKnownRequestError', { code: 'P1001' }),
    ],
    [
      'the server closed the connection',
      prismaError('PrismaClientKnownRequestError', { code: 'P1017' }),
    ],
    [
      'the connection pool timed out',
      prismaError('PrismaClientKnownRequestError', { code: 'P2024' }),
    ],
    [
      'an uncoded error saying the connection closed',
      prismaError('PrismaClientUnknownRequestError', {
        message:
          '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nServer has closed the connection.',
      }),
    ],
  ])('recognises %s', (_case, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it.each([
    ['a unique violation', prismaError('PrismaClientKnownRequestError', { code: 'P2002' })],
    ['a missing record', prismaError('PrismaClientKnownRequestError', { code: 'P2025' })],
    ['a plain error mentioning a refused connection', new Error('connection refused')],
    ['something that is not an error', 'P1001'],
  ])('does not mistake %s for an outage', (_case, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });
});
