import type { ServiceName } from '../config/config';

/**
 * What went wrong with a request, in the terms the interface needs to decide
 * what to do: sign the operator out, ask them to correct something, or say a
 * service is unavailable. The raw response never reaches the screen.
 */
export type ApiErrorKind =
  /** 401: no token, or one the service does not recognise. */
  | 'unauthorized'
  /** 403: a recognised token for another role. */
  | 'forbidden'
  /** 400 or 422: the request itself was wrong; the message says how. */
  | 'invalid-request'
  | 'rate-limited'
  /** 503: the service is up but cannot reach a dependency. */
  | 'unavailable'
  /** Any other 5xx, or an answer that could not be read. */
  | 'server'
  /** No answer at all: the service is down, or the browser blocked it. */
  | 'network'
  | 'timeout'
  /** Cancelled on purpose, because a newer request replaced it. */
  | 'aborted';

export interface ApiErrorDetails {
  service: ServiceName;
  status?: number;
  /** The backend's error code, such as BUSINESS_RULE_VIOLATION. */
  code?: string;
  /** Quote this to find the request in the service's logs. */
  correlationId?: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly details: ApiErrorDetails;

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** An error that means the operator's credentials are no longer good. */
export function endsTheSession(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'unauthorized' || error.kind === 'forbidden');
}
