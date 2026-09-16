import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

/**
 * The request's correlation id. The HTTP middleware has already normalised it
 * or issued a fresh one, so this never returns something unsafe.
 */
export const CorrelationId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const value = request.headers[HEADER_CORRELATION_ID];
  return Array.isArray(value) ? value[0] : (value ?? '');
});
