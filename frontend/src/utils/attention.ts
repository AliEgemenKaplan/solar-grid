import type { PageId } from '../app/routes';
import { SERVICE_LABELS, SERVICE_NAMES, type ServiceName } from '../config/config';
import type { ServiceHealth } from '../hooks/use-service-health';
import type { ApiError } from '../services/api-error';
import type { BillingSummary, TradeSummary } from '../types/api';
import { eventProcessing, meterPipeline, type ServiceDiagnostics } from './diagnostics';
import { formatCount, groupDigits, isZero } from './format';
import { DEPENDENCY_NAMES, downDependencies, healthState } from './system-status';

export type Severity = 'critical' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  /** What is wrong, in plain words. */
  title: string;
  /** What that means for the grid, when the system's own behaviour says so. */
  impact?: string;
  /** Where to look. */
  page: PageId;
}

/**
 * What stops working when a service is unavailable. Each sentence is what the
 * system is built to do in that case (docs/reliability.md), not a guess.
 */
const IMPACT: Record<ServiceName, string> = {
  smartMeter: 'New meter readings cannot be recorded right now.',
  pricing: 'The market price cannot be looked up, so no new trades can be matched.',
  tradeMatching: 'Spare energy and demand are not being matched into trades right now.',
  billing: 'Trades cannot be settled. They stay reserved until billing is back.',
};

/** The statistics a service's section shows, for naming a section that failed to load. */
const SECTION_NAMES: Record<ServiceName, { label: string; page: PageId }> = {
  smartMeter: { label: 'Energy statistics', page: 'energy' },
  pricing: { label: 'Price statistics', page: 'market' },
  tradeMatching: { label: 'Market statistics', page: 'trading' },
  billing: { label: 'Billing statistics', page: 'billing' },
};

export interface AttentionInput {
  health: ServiceHealth | null;
  /** The error each service's statistics answered with, if they failed. */
  sectionErrors: Partial<Record<ServiceName, ApiError | null>>;
  market: TradeSummary | null;
  billing: BillingSummary | null;
  diagnostics: ServiceDiagnostics | null;
}

const plural = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/**
 * Everything the dashboard knows is wrong or waiting, most serious first.
 *
 * Only signals the system actually gives: a service's own readiness report,
 * a statistic that failed to load, the ledger's net, trade outcomes, and the
 * event counters. Nothing is inferred beyond what those say.
 */
export function findIssues(input: AttentionInput): Issue[] {
  const issues: Issue[] = [];

  for (const service of SERVICE_NAMES) {
    const result = input.health?.[service];
    if (!result) continue;
    const state = healthState(result);
    if (state === 'ready') continue;
    const name = SERVICE_LABELS[service];
    const down = downDependencies(result);
    const title =
      result.report?.status === 'shutting_down'
        ? `${name} is shutting down`
        : state === 'unreachable'
          ? `${name} is not responding`
          : down.length > 0
            ? `${name} cannot reach ${down.map((dependency) => DEPENDENCY_NAMES[dependency] ?? dependency).join(' or ')}`
            : `${name} is not ready`;
    issues.push({
      id: `service-${service}`,
      severity: 'critical',
      title,
      impact: IMPACT[service],
      page: 'system',
    });
  }

  for (const service of SERVICE_NAMES) {
    const error = input.sectionErrors[service];
    if (!error) continue;
    // A service that is down already explains why its numbers are missing.
    const result = input.health?.[service];
    if (result && healthState(result) !== 'ready') continue;
    const section = SECTION_NAMES[service];
    issues.push({
      id: `section-${service}`,
      severity: 'warning',
      title: `${section.label} could not be loaded`,
      impact: error.message,
      page: section.page,
    });
  }

  // Without a service's counters the event checks below cannot be made for
  // it, so "no issues" would be a guess; say what is missing instead.
  for (const service of SERVICE_NAMES) {
    const error = input.diagnostics?.[service].error;
    if (!error) continue;
    const result = input.health?.[service];
    if (result && healthState(result) !== 'ready') continue;
    issues.push({
      id: `diagnostics-${service}`,
      severity: 'info',
      title: `${SERVICE_LABELS[service]} did not report its counters`,
      impact: `Its event and operation counts cannot be checked right now. ${error.message}`,
      page: 'system',
    });
  }

  const ledger = input.billing?.ledger;
  if (ledger && ledger.entries > 0 && !isZero(ledger.net)) {
    issues.push({
      id: 'books-unbalanced',
      severity: 'critical',
      title: 'The books do not balance',
      impact: `Credits and debits differ by ${groupDigits(ledger.net)} ${input.billing?.currency ?? 'TRY'} in the selected period.`,
      page: 'billing',
    });
  }

  const trades = input.market?.trades;
  if (trades && trades.failed > 0) {
    issues.push({
      id: 'trades-failed',
      severity: 'warning',
      title: `${plural(trades.failed, 'trade was', 'trades were')} refused by billing in the selected period`,
      impact: 'The energy they had reserved was released back to the market.',
      page: 'trading',
    });
  }
  if (trades && trades.pendingBilling > 0) {
    issues.push({
      id: 'trades-pending',
      severity: 'info',
      title: `${plural(trades.pendingBilling, 'trade is', 'trades are')} waiting for billing to confirm`,
      impact: 'Their energy stays reserved until billing answers.',
      page: 'trading',
    });
  }

  const events = eventProcessing(input.diagnostics?.tradeMatching.snapshot);
  if (events.deadLettered !== null && events.deadLettered > 0) {
    issues.push({
      id: 'events-dead-lettered',
      severity: 'warning',
      title: `${plural(events.deadLettered, 'meter event', 'meter events')} could not be processed`,
      impact:
        'They were set aside after repeated attempts and need an operator to look at them. Counted since trade matching last started.',
      page: 'system',
    });
  }
  if (events.rejected !== null && events.rejected > 0) {
    issues.push({
      id: 'events-rejected',
      severity: 'warning',
      title: `${plural(events.rejected, 'meter event was', 'meter events were')} invalid and set aside`,
      impact:
        'Their content was missing or malformed, so they went to the dead-letter queue without being used. Counted since trade matching last started.',
      page: 'system',
    });
  }

  const meter = meterPipeline(input.diagnostics?.smartMeter.snapshot);
  if (meter.waitingNow !== null && meter.waitingNow > 0) {
    issues.push({
      id: 'events-waiting',
      severity: 'info',
      title: `${plural(meter.waitingNow, 'meter event is', 'meter events are')} waiting to be delivered`,
      impact: 'They are stored safely and will be sent as soon as the message broker accepts them.',
      page: 'system',
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
