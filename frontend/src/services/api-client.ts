import type { DashboardConfig, ServiceName } from '../config/config';
import { SERVICE_LABELS } from '../config/config';
import type { ApiErrorBody } from '../types/api';
import { ApiError, type ApiErrorKind } from './api-error';

export const CORRELATION_HEADER = 'x-correlation-id';

export type QueryValue = string | number | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** Cancels the request, for example when a newer one replaces it. */
  signal?: AbortSignal;
  /** Send the operator token. Health and the current price are public. */
  authenticated?: boolean;
  /** A token to use instead of the signed-in one: checking a new one at sign-in. */
  token?: string;
  /**
   * Error statuses whose body is still the answer: readiness replies 503 with
   * a report saying which dependency is down.
   */
  acceptStatuses?: number[];
}

export interface ApiResponse<T> {
  data: T;
  /** The id the service logged this request under. */
  correlationId: string;
  status: number;
  durationMs: number;
}

export interface ApiClientOptions {
  config: Pick<DashboardConfig, 'apiUrls' | 'requestTimeoutMs'>;
  /** The signed-in operator's token, read at the moment of each request. */
  getToken?: () => string | null;
  fetch?: typeof fetch;
  now?: () => number;
  newCorrelationId?: () => string;
}

/**
 * The one place the dashboard talks to the services.
 *
 * Every request gets its own correlation id, sent as x-correlation-id, so an
 * error on screen can be found in the service's logs. Every request has a
 * timeout and can be cancelled. Failures become an ApiError with a kind the
 * interface can act on; a backend message is only passed through where the
 * backend writes it for clients (400 and 422), never for a 5xx.
 *
 * The token is added to the Authorization header and goes nowhere else: it is
 * not logged, not put in a URL and not copied into an error.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly newCorrelationId: () => string;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => performance.now());
    this.newCorrelationId = options.newCorrelationId ?? defaultCorrelationId;
  }

  async get<T>(
    service: ServiceName,
    path: string,
    request: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const url = this.url(service, path, request.query);
    const correlationId = this.newCorrelationId();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [CORRELATION_HEADER]: correlationId,
    };
    const token =
      request.token ?? (request.authenticated === false ? null : this.options.getToken?.());
    if (request.authenticated !== false && token) headers.Authorization = `Bearer ${token}`;

    // The timeout covers reading the body too, not just the headers.
    const cancel = linkedAbort(request.signal, this.options.config.requestTimeoutMs);
    const started = this.now();
    try {
      let response: Response;
      let body: unknown;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: cancel.signal,
          // Tokens travel in a header, never as cookies.
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        body = await readJson(response);
      } catch {
        const kind: ApiErrorKind = cancel.timedOut()
          ? 'timeout'
          : cancel.signal.aborted
            ? 'aborted'
            : 'network';
        throw new ApiError(kind, transportMessage(kind, service), { service, correlationId });
      }

      const answeredAs = response.headers.get(CORRELATION_HEADER) ?? correlationId;
      if (!response.ok && !request.acceptStatuses?.includes(response.status)) {
        throw toApiError(service, response.status, body, answeredAs);
      }
      if (body === undefined) {
        throw new ApiError(
          'server',
          `${SERVICE_LABELS[service]} sent an answer that could not be read.`,
          { service, status: response.status, correlationId: answeredAs },
        );
      }
      return {
        data: body as T,
        correlationId: answeredAs,
        status: response.status,
        durationMs: Math.round(this.now() - started),
      };
    } finally {
      cancel.dispose();
    }
  }

  private url(service: ServiceName, path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.options.config.apiUrls[service]}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

function toApiError(
  service: ServiceName,
  status: number,
  body: unknown,
  correlationId: string,
): ApiError {
  const errorBody = isErrorBody(body) ? body : undefined;
  const details = { service, status, code: errorBody?.code, correlationId };
  const label = SERVICE_LABELS[service];

  if (status === 401) {
    return new ApiError('unauthorized', 'The operator token was not accepted.', details);
  }
  if (status === 403) {
    return new ApiError('forbidden', 'This token is not an operator token.', details);
  }
  if (status === 400 || status === 422) {
    // Written by the backend for clients: "from must be earlier than to."
    const message = errorBody?.message ?? `${label} could not answer that request.`;
    return new ApiError('invalid-request', message, details);
  }
  if (status === 429) {
    return new ApiError(
      'rate-limited',
      `${label} is limiting requests. Try again shortly.`,
      details,
    );
  }
  if (status === 503) {
    return new ApiError('unavailable', `${label} is temporarily unavailable.`, details);
  }
  return new ApiError('server', `${label} could not complete the request.`, details);
}

function transportMessage(kind: ApiErrorKind, service: ServiceName): string {
  const label = SERVICE_LABELS[service];
  if (kind === 'timeout') return `${label} did not answer in time.`;
  if (kind === 'aborted') return 'The request was replaced by a newer one.';
  return `${label} could not be reached.`;
}

/**
 * The body as JSON, or undefined when it is not JSON. A body that claims to be
 * JSON and is not is also undefined; an aborted read rethrows, so a timeout is
 * reported as one.
 */
async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return undefined;
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ApiErrorBody).code === 'string' &&
    typeof (body as ApiErrorBody).message === 'string'
  );
}

/**
 * One signal for a request that is cancelled either by the caller or by its
 * own timeout, remembering which it was so a timeout is not reported as a
 * cancellation.
 */
function linkedAbort(outer: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    },
  };
}

function defaultCorrelationId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `dashboard-${random}`;
}
