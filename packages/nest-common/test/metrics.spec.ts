import { Logger } from '@nestjs/common';
import { MetricsRegistry } from '../src/metrics/metrics-registry';

/** The value of one series in Prometheus text output, or undefined. */
export function sample(text: string, name: string, labels: Record<string, string> = {}) {
  for (const line of text.split('\n')) {
    if (!line.startsWith(`${name}{`) && !line.startsWith(`${name} `)) continue;
    const matchesLabels = Object.entries(labels).every(([key, value]) =>
      line.includes(`${key}="${value}"`),
    );
    if (matchesLabels) return Number(line.slice(line.lastIndexOf(' ') + 1));
  }
  return undefined;
}

describe('MetricsRegistry', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('prefixes every metric and labels it with the service', async () => {
    const metrics = new MetricsRegistry('billing-ledger-service');
    metrics.counter('settlements_total', 'help', ['outcome']).inc({ outcome: 'recorded' });

    const text = await metrics.render();

    expect(
      sample(text, 'solargrid_settlements_total', {
        outcome: 'recorded',
        service: 'billing-ledger-service',
      }),
    ).toBe(1);
    expect(metrics.contentType).toContain('text/plain');
  });

  it('counts HTTP requests by route template and status, and times them', async () => {
    const metrics = new MetricsRegistry('svc');
    const request = {
      method: 'GET',
      route: '/trades/:tradeId',
      path: '/trades/TRD-1',
      statusCode: 404,
      durationMs: 12,
      aborted: false,
    };

    metrics.observeRequest(request);
    metrics.observeRequest({ ...request, path: '/trades/TRD-2' });
    const text = await metrics.render();

    expect(
      sample(text, 'solargrid_http_requests_total', {
        route: '/trades/:tradeId',
        status: '404',
      }),
    ).toBe(2);
    expect(
      sample(text, 'solargrid_http_request_duration_seconds_count', {
        route: '/trades/:tradeId',
      }),
    ).toBe(2);
    // The raw path never becomes a label: one series per route, whatever the ids.
    expect(text).not.toContain('TRD-1');
  });

  it('tracks dependency failures and the last readiness answer', async () => {
    const metrics = new MetricsRegistry('svc');

    metrics.dependencyFailed('database');
    metrics.dependencyFailed('database');
    metrics.dependencyStatus('database', false);
    metrics.dependencyStatus('rabbitmq', true);
    const text = await metrics.render();

    expect(sample(text, 'solargrid_dependency_failures_total', { dependency: 'database' })).toBe(2);
    expect(sample(text, 'solargrid_dependency_up', { dependency: 'database' })).toBe(0);
    expect(sample(text, 'solargrid_dependency_up', { dependency: 'rabbitmq' })).toBe(1);
  });

  it('refreshes a gauge from its source on every scrape', async () => {
    const metrics = new MetricsRegistry('svc');
    let pending = 3;
    metrics.gauge('outbox_events_pending', 'help', [], async (set) => set({}, pending));

    expect(sample(await metrics.render(), 'solargrid_outbox_events_pending')).toBe(3);
    pending = 0;
    expect(sample(await metrics.render(), 'solargrid_outbox_events_pending')).toBe(0);
  });

  describe('never breaks the code it measures', () => {
    it('swallows a recording error', () => {
      const metrics = new MetricsRegistry('svc');
      const counter = metrics.counter('things_total', 'help', ['kind']);

      expect(() => counter.inc({ unexpected: 'label' })).not.toThrow();
    });

    it('still renders when a gauge cannot read its source', async () => {
      const metrics = new MetricsRegistry('svc');
      metrics.gauge('offers_open', 'help', [], async () => {
        throw new Error('database is down');
      });
      metrics.counter('things_total', 'help').inc();

      const text = await metrics.render();

      expect(sample(text, 'solargrid_things_total')).toBe(1);
    });
  });

  it('keeps each service registry separate', async () => {
    const first = new MetricsRegistry('a');
    const second = new MetricsRegistry('b');
    first.counter('things_total', 'help').inc();
    second.counter('things_total', 'help');

    expect(sample(await first.render(), 'solargrid_things_total')).toBe(1);
    expect(sample(await second.render(), 'solargrid_things_total')).toBe(0);
  });
});
