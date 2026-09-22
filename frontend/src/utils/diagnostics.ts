import type { ServiceName } from '../config/config';
import type { ApiError } from '../services/api-error';
import type { DiagnosticsSnapshot } from '../types/api';

/**
 * Reading the services' own counters (GET /diagnostics).
 *
 * These are counts of events - messages handled, requests served, retries -
 * not money or energy, so adding them up here is fine. Every counter starts
 * from zero when its service starts; the snapshot says when that was. A
 * metric a snapshot does not contain is reported as null, never as zero: the
 * dashboard does not know it was zero, only that it was not told.
 */

export interface ServiceDiagnosticsResult {
  snapshot: DiagnosticsSnapshot | null;
  error: ApiError | null;
}

export type ServiceDiagnostics = Record<ServiceName, ServiceDiagnosticsResult>;

type Where = Record<string, string>;

function matches(labels: Record<string, string>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => labels[key] === value);
}

/** The sum of a counter's or gauge's series, optionally only those with these labels. */
export function total(
  snapshot: DiagnosticsSnapshot | null | undefined,
  name: string,
  where: Where = {},
): number | null {
  const metric = snapshot?.metrics.find((entry) => entry.name === name);
  if (!metric) return null;
  return metric.series
    .filter((series) => matches(series.labels, where))
    .reduce((sum, series) => sum + series.value, 0);
}

/** A counter's series summed per value of one label: `{ processed: 12, duplicate: 1 }`. */
export function byLabel(
  snapshot: DiagnosticsSnapshot | null | undefined,
  name: string,
  label: string,
): Record<string, number> | null {
  const metric = snapshot?.metrics.find((entry) => entry.name === name);
  if (!metric) return null;
  const totals: Record<string, number> = {};
  for (const series of metric.series) {
    const key = series.labels[label] ?? 'unknown';
    totals[key] = (totals[key] ?? 0) + series.value;
  }
  return totals;
}

export interface HttpSummary {
  requests: number;
  succeeded: number;
  /** 4xx: the caller's request was refused - bad input, no token, not found. */
  refused: number;
  /** 5xx: the service could not answer. */
  failed: number;
  /** Mean time to answer, in milliseconds; null before the first request. */
  averageMs: number | null;
}

export function httpSummary(snapshot: DiagnosticsSnapshot | null | undefined): HttpSummary | null {
  const requests = snapshot?.metrics.find((entry) => entry.name === 'http_requests_total');
  if (!requests) return null;
  const summary: HttpSummary = {
    requests: 0,
    succeeded: 0,
    refused: 0,
    failed: 0,
    averageMs: null,
  };
  for (const series of requests.series) {
    summary.requests += series.value;
    const status = series.labels.status ?? '';
    if (status.startsWith('5')) summary.failed += series.value;
    else if (status.startsWith('4')) summary.refused += series.value;
    else summary.succeeded += series.value;
  }
  const duration = snapshot?.metrics.find(
    (entry) => entry.name === 'http_request_duration_seconds',
  );
  if (duration) {
    const count = duration.series.reduce((sum, series) => sum + series.value, 0);
    const seconds = duration.series.reduce((sum, series) => sum + (series.sum ?? 0), 0);
    summary.averageMs = count > 0 ? Math.round((seconds / count) * 1000) : null;
  }
  return summary;
}

/** smart-meter: readings in, events out through the outbox to the broker. */
export interface MeterPipeline {
  readingsNew: number | null;
  readingsRepeated: number | null;
  eventsQueued: number | null;
  eventsDelivered: number | null;
  deliveryFailures: number | null;
  waitingNow: number | null;
}

export function meterPipeline(snapshot: DiagnosticsSnapshot | null | undefined): MeterPipeline {
  return {
    readingsNew: total(snapshot, 'readings_total', { result: 'created' }),
    readingsRepeated: total(snapshot, 'readings_total', { result: 'duplicate' }),
    eventsQueued: total(snapshot, 'outbox_events_created_total'),
    eventsDelivered: total(snapshot, 'outbox_events_published_total'),
    deliveryFailures: total(snapshot, 'outbox_publish_failures_total'),
    waitingNow: total(snapshot, 'outbox_events_pending'),
  };
}

/** trade-matching: what became of each event it received. */
export interface EventProcessing {
  processed: number | null;
  duplicates: number | null;
  retries: number | null;
  deadLettered: number | null;
  rejected: number | null;
}

export function eventProcessing(snapshot: DiagnosticsSnapshot | null | undefined): EventProcessing {
  const outcomes = byLabel(snapshot, 'messages_total', 'outcome');
  const outcome = (key: string) => (outcomes ? (outcomes[key] ?? 0) : null);
  return {
    processed: outcome('processed'),
    duplicates: outcome('duplicate'),
    retries: outcome('retry_scheduled'),
    deadLettered: outcome('dead_lettered'),
    rejected: outcome('rejected'),
  };
}

/** trade-matching: matching runs, reservations and what billing said. */
export interface MarketOperations {
  runsCompleted: number | null;
  runsWithoutPrice: number | null;
  runsFailed: number | null;
  tradesReserved: number | null;
  billingSettled: number | null;
  billingRefused: number | null;
  billingNoAnswer: number | null;
  openOffers: number | null;
  openRequests: number | null;
  awaitingBilling: number | null;
}

export function marketOperations(
  snapshot: DiagnosticsSnapshot | null | undefined,
): MarketOperations {
  return {
    runsCompleted: total(snapshot, 'matching_runs_total', { outcome: 'completed' }),
    runsWithoutPrice: total(snapshot, 'matching_runs_total', { outcome: 'pricing_unavailable' }),
    runsFailed: total(snapshot, 'matching_runs_total', { outcome: 'failed' }),
    tradesReserved: total(snapshot, 'trades_reserved_total'),
    billingSettled: total(snapshot, 'trade_billing_outcomes_total', { outcome: 'settled' }),
    billingRefused: total(snapshot, 'trade_billing_outcomes_total', { outcome: 'rejected' }),
    billingNoAnswer: total(snapshot, 'trade_billing_outcomes_total', { outcome: 'unknown' }),
    openOffers: total(snapshot, 'offers_open'),
    openRequests: total(snapshot, 'requests_open'),
    awaitingBilling: total(snapshot, 'trades_pending_billing'),
  };
}

/** billing: requests to record a trade, by what happened to them. */
export interface LedgerOperations {
  recorded: number | null;
  repeated: number | null;
  conflicts: number | null;
  refused: number | null;
}

export function ledgerOperations(
  snapshot: DiagnosticsSnapshot | null | undefined,
): LedgerOperations {
  const outcomes = byLabel(snapshot, 'settlements_total', 'outcome');
  const outcome = (...keys: string[]) =>
    outcomes ? keys.reduce((sum, key) => sum + (outcomes[key] ?? 0), 0) : null;
  return {
    recorded: outcome('recorded'),
    repeated: outcome('replayed'),
    conflicts: outcome('idempotency_conflict', 'conflict'),
    refused: outcome('rejected'),
  };
}

/** Times a service could not reach something it depends on, by what it was. */
export function dependencyFailures(
  snapshot: DiagnosticsSnapshot | null | undefined,
): Record<string, number> | null {
  return byLabel(snapshot, 'dependency_failures_total', 'dependency');
}
