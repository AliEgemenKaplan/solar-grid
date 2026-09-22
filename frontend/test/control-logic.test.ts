import { describe, expect, it } from 'vitest';
import { hashFor, pageFromHash } from '../src/app/routes';
import type { ServiceHealth } from '../src/hooks/use-service-health';
import { findIssues, type AttentionInput } from '../src/utils/attention';
import {
  byLabel,
  eventProcessing,
  httpSummary,
  ledgerOperations,
  marketOperations,
  meterPipeline,
  total,
  type ServiceDiagnostics,
} from '../src/utils/diagnostics';
import { formatAgo, formatShare, sumDecimals } from '../src/utils/format';
import { healthState, systemStatus } from '../src/utils/system-status';
import { periodLabel, presetWindow } from '../src/utils/time-range';
import {
  apiError,
  billingSummary,
  diagnosticsSnapshots,
  readiness,
  tradeSummary,
} from './fixtures';

const checkedAt = new Date('2026-09-19T12:00:00.000Z');

function health(
  states: Partial<Record<keyof ServiceHealth, 'ready' | 'not_ready' | 'unreachable'>> = {},
): ServiceHealth {
  const result = (service: string, state = 'ready') =>
    state === 'unreachable'
      ? { report: null, httpStatus: null, latencyMs: null, error: apiError('network'), checkedAt }
      : {
          report: readiness(service, state as 'ready' | 'not_ready'),
          httpStatus: state === 'ready' ? 200 : 503,
          latencyMs: 5,
          error: null,
          checkedAt,
        };
  return {
    smartMeter: result('smartMeter', states.smartMeter),
    pricing: result('pricing', states.pricing),
    tradeMatching: result('tradeMatching', states.tradeMatching),
    billing: result('billing', states.billing),
  };
}

const diagnostics = (): ServiceDiagnostics => ({
  smartMeter: { snapshot: diagnosticsSnapshots.smartMeter!, error: null },
  pricing: { snapshot: diagnosticsSnapshots.pricing!, error: null },
  tradeMatching: { snapshot: diagnosticsSnapshots.tradeMatching!, error: null },
  billing: { snapshot: diagnosticsSnapshots.billing!, error: null },
});

const quiet: AttentionInput = {
  health: health(),
  sectionErrors: {},
  market: { ...tradeSummary, trades: { total: 2, completed: 2, pendingBilling: 0, failed: 0 } },
  billing: billingSummary,
  diagnostics: null,
};

describe('the system status', () => {
  it('is operational only when every service is ready', () => {
    expect(systemStatus(health())).toMatchObject({ state: 'operational', ready: 4, total: 4 });
    expect(systemStatus(health({ billing: 'not_ready' }))).toMatchObject({
      state: 'degraded',
      ready: 3,
      affected: ['billing'],
    });
    expect(
      systemStatus(
        health({
          smartMeter: 'unreachable',
          pricing: 'unreachable',
          tradeMatching: 'unreachable',
          billing: 'unreachable',
        }),
      ).state,
    ).toBe('down');
    expect(systemStatus(null).state).toBe('checking');
  });

  it('tells a service that answered "not ready" from one that did not answer', () => {
    const states = health({ billing: 'not_ready', pricing: 'unreachable' });
    expect(healthState(states.billing)).toBe('degraded');
    expect(healthState(states.pricing)).toBe('unreachable');
    expect(healthState(states.smartMeter)).toBe('ready');
  });
});

describe('what needs attention', () => {
  it('finds nothing when there is nothing', () => {
    expect(findIssues(quiet)).toEqual([]);
  });

  it('names a service that is down and what that stops, before anything else', () => {
    const issues = findIssues({
      ...quiet,
      health: health({ billing: 'not_ready' }),
      market: tradeSummary,
    });
    expect(issues[0]).toMatchObject({
      severity: 'critical',
      title: 'Billing ledger cannot reach its database',
      impact: 'Trades cannot be settled. They stay reserved until billing is back.',
      page: 'system',
    });
    expect(issues.map((issue) => issue.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('does not report a missing statistic twice when its service is down', () => {
    const issues = findIssues({
      ...quiet,
      health: health({ smartMeter: 'unreachable' }),
      sectionErrors: { smartMeter: apiError('network') },
    });
    expect(issues.map((issue) => issue.id)).toEqual(['service-smartMeter']);
  });

  it('flags books that do not balance, but not an empty ledger', () => {
    const off = { ...billingSummary, ledger: { ...billingSummary.ledger, net: '0.01' } };
    expect(findIssues({ ...quiet, billing: off })[0]).toMatchObject({
      id: 'books-unbalanced',
      severity: 'critical',
    });
    const empty = {
      ...billingSummary,
      ledger: { entries: 0, credited: '0.00', debited: '0.00', net: '0.00', households: 0 },
    };
    expect(findIssues({ ...quiet, billing: empty })).toEqual([]);
  });

  it('reports events set aside or waiting, from the services own counters', () => {
    const counters = diagnostics();
    counters.tradeMatching.snapshot = {
      ...counters.tradeMatching.snapshot!,
      metrics: [
        {
          name: 'messages_total',
          help: '',
          type: 'counter',
          series: [
            { labels: { outcome: 'dead_lettered' }, value: 2 },
            { labels: { outcome: 'rejected' }, value: 1 },
          ],
        },
      ],
    };
    const titles = findIssues({ ...quiet, diagnostics: counters }).map((issue) => issue.title);
    expect(titles).toEqual([
      '2 meter events could not be processed',
      '1 meter event was invalid and set aside',
      '2 meter events are waiting to be delivered',
    ]);
  });

  it('says so when a service did not report its counters, rather than assuming all is well', () => {
    const counters = diagnostics();
    counters.billing = {
      snapshot: null,
      error: apiError('timeout', 'Billing ledger took too long.'),
    };
    const smartMeter = diagnosticsSnapshots.smartMeter!;
    counters.smartMeter.snapshot = {
      ...smartMeter,
      metrics: smartMeter.metrics.filter((metric) => metric.name !== 'outbox_events_pending'),
    };

    expect(findIssues({ ...quiet, diagnostics: counters })).toEqual([
      expect.objectContaining({
        id: 'diagnostics-billing',
        severity: 'info',
        title: 'Billing ledger did not report its counters',
      }),
    ]);
  });
});

describe('the services counters', () => {
  const tradeMatching = diagnosticsSnapshots.tradeMatching!;

  it('adds series up, optionally only those with some labels', () => {
    expect(total(tradeMatching, 'messages_total')).toBe(243);
    expect(total(tradeMatching, 'messages_total', { outcome: 'processed' })).toBe(238);
    expect(byLabel(tradeMatching, 'messages_total', 'outcome')).toEqual({
      processed: 238,
      duplicate: 3,
      retry_scheduled: 2,
    });
  });

  it('says a counter it was not given is unknown, not zero', () => {
    expect(total(tradeMatching, 'not_a_metric')).toBeNull();
    expect(total(null, 'messages_total')).toBeNull();
    expect(eventProcessing(null).processed).toBeNull();
    // Given, but with no series for an outcome: that outcome never happened.
    expect(eventProcessing(tradeMatching).deadLettered).toBe(0);
  });

  it('sums requests by class and works out the average time', () => {
    expect(httpSummary(diagnosticsSnapshots.smartMeter)).toEqual({
      requests: 100,
      succeeded: 98,
      refused: 2,
      failed: 0,
      averageMs: 12,
    });
    expect(httpSummary(null)).toBeNull();
  });

  it('reads each pipeline stage', () => {
    expect(meterPipeline(diagnosticsSnapshots.smartMeter)).toEqual({
      readingsNew: 240,
      readingsRepeated: 3,
      eventsQueued: 240,
      eventsDelivered: 238,
      deliveryFailures: 1,
      waitingNow: 2,
    });
    expect(marketOperations(tradeMatching)).toMatchObject({
      runsCompleted: 30,
      runsWithoutPrice: 1,
      runsFailed: 0,
      billingSettled: 2,
      billingRefused: 1,
      billingNoAnswer: 0,
      awaitingBilling: 1,
    });
    expect(ledgerOperations(diagnosticsSnapshots.billing)).toEqual({
      recorded: 2,
      repeated: 1,
      conflicts: 0,
      refused: 0,
    });
  });
});

describe('small formats', () => {
  it('adds decimal strings exactly, at the largest scale', () => {
    expect(sumDecimals('10.000', '0.500')).toBe('10.500');
    expect(sumDecimals('0.1', '0.2')).toBe('0.3');
    expect(sumDecimals('9007199254740993.001', '1.000')).toBe('9007199254740994.001');
    expect(sumDecimals('-4.000', '1.5')).toBe('-2.500');
    expect(() => sumDecimals('1e5')).toThrow();
  });

  it('says how long ago, in words', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');
    const before = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(formatAgo(before(2), now)).toBe('just now');
    expect(formatAgo(before(12), now)).toBe('12 s ago');
    expect(formatAgo(before(4 * 60 + 5), now)).toBe('4 min ago');
    expect(formatAgo(before(2 * 3600), now)).toBe('2 h ago');
  });

  it('gives shares of a count, and no share of nothing', () => {
    expect(formatShare(1, 4)).toBe('25%');
    expect(formatShare(1, 30)).toBe('3.3%');
    expect(formatShare(0, 0)).toBe('—');
  });

  it('names the period every figure covers', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');
    expect(periodLabel(presetWindow('24h', now))).toBe('Last 24 hours');
    expect(
      periodLabel({
        preset: 'custom',
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-04T00:00:00.000Z'),
        bucket: 'day',
      }),
    ).toBe('01 Sep – 03 Sep 2026');
  });
});

describe('addresses', () => {
  it.each([
    ['#/market', 'market'],
    ['#market', 'market'],
    ['#/system?x=1', 'system'],
    ['', 'overview'],
    ['#/nowhere', 'overview'],
    ['#/constructor', 'overview'],
  ])('reads %s as the %s page', (hash, page) => {
    expect(pageFromHash(hash)).toBe(page);
  });

  it('writes a page as a hash', () => {
    expect(hashFor('households')).toBe('#/households');
  });
});
