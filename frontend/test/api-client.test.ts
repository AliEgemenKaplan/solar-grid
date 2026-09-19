import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/services/api-client';
import { ApiError } from '../src/services/api-error';
import { createSolarGridApi } from '../src/services/solar-grid-api';
import { TEST_CONFIG } from './fixtures';

const TOKEN = 'operator-token-for-tests-0123456789';

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function client(fetchImpl: typeof fetch, token: string | null = TOKEN) {
  return new ApiClient({
    config: TEST_CONFIG,
    getToken: () => token,
    fetch: fetchImpl,
    newCorrelationId: () => 'dashboard-test-id',
  });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ApiClient', () => {
  it('sends the token, a correlation id and the query, and returns the data', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(200, { readings: 3 }, { 'x-correlation-id': 'dashboard-test-id' }),
    );
    const response = await client(fetchImpl).get('smartMeter', '/stats/summary', {
      query: {
        from: '2026-09-18T00:00:00.000Z',
        to: '2026-09-19T00:00:00.000Z',
        skipped: undefined,
      },
    });

    expect(response).toMatchObject({
      data: { readings: 3 },
      status: 200,
      correlationId: 'dashboard-test-id',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'http://meter.test/stats/summary?from=2026-09-18T00%3A00%3A00.000Z&to=2026-09-19T00%3A00%3A00.000Z',
    );
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'x-correlation-id': 'dashboard-test-id',
    });
    expect(init.credentials).toBe('omit');
  });

  it('never puts the token in the URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, {}));
    await client(fetchImpl).get('billing', '/stats/summary');
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain(TOKEN);
  });

  it('sends no token to public endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, { status: 'ready' }));
    await client(fetchImpl).get('pricing', '/health/ready', { authenticated: false });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('reads the correlation id the service answered with', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(200, {}, { 'x-correlation-id': 'server-side-id' }),
    );
    const response = await client(fetchImpl).get('billing', '/stats/summary');
    expect(response.correlationId).toBe('server-side-id');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
    [500, 'server'],
  ] as const)(
    'maps %i to %s, with the correlation id of the failed request',
    async (status, kind) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        json(
          status,
          { statusCode: status, code: 'X', message: 'internal detail', correlationId: 'failed-id' },
          {
            'x-correlation-id': 'failed-id',
          },
        ),
      );
      const error = await failure(client(fetchImpl).get('tradeMatching', '/stats/summary'));
      expect(error.kind).toBe(kind);
      expect(error.details).toMatchObject({
        service: 'tradeMatching',
        status,
        correlationId: 'failed-id',
      });
    },
  );

  it('passes on the message the backend writes for a rejected request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(422, {
        statusCode: 422,
        code: 'BUSINESS_RULE_VIOLATION',
        message: 'from must be earlier than to.',
        correlationId: 'id',
      }),
    );
    const error = await failure(client(fetchImpl).get('billing', '/stats/summary'));
    expect(error).toMatchObject({
      kind: 'invalid-request',
      message: 'from must be earlier than to.',
    });
    expect(error.details.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('never shows what a server error says about itself', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json(500, {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'relation "trade_matches" does not exist at postgres:5432',
        correlationId: 'id',
      }),
    );
    const error = await failure(client(fetchImpl).get('tradeMatching', '/stats/summary'));
    expect(error.message).toBe('Trade matching could not complete the request.');
    expect(JSON.stringify(error)).not.toMatch(/postgres|does not exist|trade_matches/);
  });

  it('keeps a readiness report that comes with a 503', async () => {
    const report = { status: 'not_ready', service: 'billing', timestamp: 'now', checks: {} };
    const fetchImpl = vi.fn<typeof fetch>(async () => json(503, report));
    const result = await createSolarGridApi(client(fetchImpl)).readiness('billing');
    expect(result).toMatchObject({ report, httpStatus: 503, error: null });
  });

  it('reports a service that cannot be reached as unreachable, not as a crash', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await failure(client(fetchImpl).get('pricing', '/stats/summary'));
    expect(error).toMatchObject({
      kind: 'network',
      message: 'Pricing engine could not be reached.',
    });
    expect(error.details.correlationId).toBe('dashboard-test-id');
  });

  it('gives up after the timeout and says so', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = failure(client(fetchImpl as typeof fetch).get('billing', '/stats/summary'));
    await vi.advanceTimersByTimeAsync(TEST_CONFIG.requestTimeoutMs);
    const error = await pending;
    expect(error).toMatchObject({
      kind: 'timeout',
      message: 'Billing ledger did not answer in time.',
    });
  });

  it('tells a cancellation apart from a timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = failure(
      client(fetchImpl as typeof fetch).get('billing', '/stats/summary', {
        signal: controller.signal,
      }),
    );
    controller.abort();
    expect((await pending).kind).toBe('aborted');
  });

  it('refuses an answer that is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('<html>proxy error</html>', { status: 200 }),
    );
    const error = await failure(client(fetchImpl).get('billing', '/stats/summary'));
    expect(error.kind).toBe('server');
  });

  it('builds every statistics request from a window, without extra parameters', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, {}));
    const api = createSolarGridApi(client(fetchImpl));
    const window = { from: '2026-09-18T00:00:00.000Z', to: '2026-09-19T00:00:00.000Z' };

    await api.tradeTrend(window, 'hour');
    await api.billingHouseholds({ ...window, page: 2, limit: 10 });

    const urls = fetchImpl.mock.calls.map((call) => new URL(String(call[0])));
    expect(urls[0]!.pathname).toBe('/stats/trends');
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ bucket: 'hour', ...window });
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      ...window,
      page: '2',
      limit: '10',
    });
  });
});
