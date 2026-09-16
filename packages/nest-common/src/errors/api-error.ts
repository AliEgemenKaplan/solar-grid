import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/**
 * What went wrong, in a form a client can branch on.
 *
 * The HTTP status says how to treat the response; the code says which of the
 * several things that share a status actually happened, so a caller does not
 * have to match on message text.
 */
export const ApiErrorCode = {
  /** The request did not satisfy the schema: wrong types, bad decimals, out of range. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** No credentials, or credentials nobody recognises. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Recognised credentials that are not allowed to do this. */
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  /** Something already exists that this request would duplicate. */
  CONFLICT: 'CONFLICT',
  /** The idempotency key has been used before with a different payload. */
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  /** Well formed, but the system cannot do it: a household trading with itself. */
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  /** A service this request depends on did not answer. */
  DOWNSTREAM_UNAVAILABLE: 'DOWNSTREAM_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** The body every failing request returns, whichever service produced it. */
export class ApiErrorResponse {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: ApiErrorCode.IDEMPOTENCY_CONFLICT, enum: Object.values(ApiErrorCode) })
  code!: ApiErrorCode;

  @ApiProperty({ example: 'This idempotency key was used with a different payload.' })
  message!: string;

  @ApiProperty({
    example: 'a3f1c2b4-5d6e-7f80-9a1b-2c3d4e5f6071',
    description: 'Find this request in the logs, across every service it touched.',
  })
  correlationId!: string;

  @ApiProperty({ example: '2026-09-16T10:15:30.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/trades' })
  path!: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Field level problems, when the request failed validation.',
    example: ['energyKwh must be a decimal string between 0.001 and 1000000'],
  })
  details?: string[];
}

/** Body shape carried inside an HttpException so the filter can read the code. */
interface CodedExceptionBody {
  code: ApiErrorCode;
  message: string;
  details?: string[];
}

export function codedBody(
  code: ApiErrorCode,
  message: string,
  details?: string[],
): CodedExceptionBody {
  return details ? { code, message, details } : { code, message };
}

export function readCodedBody(exception: HttpException): CodedExceptionBody | null {
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null) return null;
  const candidate = response as Partial<CodedExceptionBody>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
    ? (candidate as CodedExceptionBody)
    : null;
}

/** 401: no credentials, or credentials nobody recognises. */
export class UnauthenticatedException extends UnauthorizedException {
  constructor(message = 'Authentication is required for this endpoint.') {
    super(codedBody(ApiErrorCode.UNAUTHENTICATED, message));
  }
}

/** 403: recognised credentials, wrong scope. */
export class NotPermittedException extends ForbiddenException {
  constructor(message = 'These credentials are not allowed to perform this action.') {
    super(codedBody(ApiErrorCode.FORBIDDEN, message));
  }
}

/** 404 */
export class ResourceNotFoundException extends NotFoundException {
  constructor(message: string) {
    super(codedBody(ApiErrorCode.NOT_FOUND, message));
  }
}

/** 409: the same idempotency key, a different request. */
export class IdempotencyConflictException extends ConflictException {
  constructor(
    message = 'This idempotency key was used with a different payload.',
    details?: string[],
  ) {
    super(codedBody(ApiErrorCode.IDEMPOTENCY_CONFLICT, message, details));
  }
}

/** 409: this would duplicate something that already exists. */
export class ResourceConflictException extends ConflictException {
  constructor(message: string) {
    super(codedBody(ApiErrorCode.CONFLICT, message));
  }
}

/**
 * 422: the request is well formed and the types are right, but the system
 * cannot carry it out - a household trading with itself, an amount that does
 * not match the energy and the price it claims to be.
 */
export class BusinessRuleViolationException extends UnprocessableEntityException {
  constructor(message: string, details?: string[]) {
    super(codedBody(ApiErrorCode.BUSINESS_RULE_VIOLATION, message, details));
  }
}

/** 503: a service this request depends on did not answer. */
export class DownstreamUnavailableException extends ServiceUnavailableException {
  constructor(message: string) {
    super(codedBody(ApiErrorCode.DOWNSTREAM_UNAVAILABLE, message));
  }
}
