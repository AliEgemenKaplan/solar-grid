import type { ReactNode } from 'react';
import { SERVICE_LABELS, SERVICE_NAMES, type ServiceName } from '../../config/config';
import type { Resource } from '../../hooks/use-resource';
import type { ServiceHealth } from '../../hooks/use-service-health';
import {
  dependencyFailures,
  eventProcessing,
  httpSummary,
  ledgerOperations,
  marketOperations,
  meterPipeline,
  total,
  type ServiceDiagnostics,
} from '../../utils/diagnostics';
import { formatCount, formatDateTime, formatLatency, formatTime } from '../../utils/format';
import { downDependencies, healthState } from '../../utils/system-status';
import { ArrowRightIcon } from '../ui/icons';
import { Card, Help } from '../ui/layout';
import { cx, LoadingBlock, Skeleton, StatusBadge, type Tone } from '../ui/primitives';

/** What each service does, for someone who has never heard of it. */
const PURPOSE: Record<ServiceName, string> = {
  smartMeter:
    'Receives readings from household meters and announces who has spare energy or needs it.',
  pricing: 'Sets the price of energy from how much is offered and how much is wanted.',
  tradeMatching: 'Matches spare energy with demand, and asks billing to record each trade.',
  billing: 'Records every settled trade in the ledger and keeps each household’s balance.',
};

const STATE = {
  ready: { tone: 'good' as Tone, word: 'Ready', meaning: 'Working normally.' },
  degraded: {
    tone: 'warning' as Tone,
    word: 'Degraded',
    meaning: 'Running, but cannot do its work.',
  },
  unreachable: { tone: 'critical' as Tone, word: 'Unavailable', meaning: 'Not responding at all.' },
};

const DEPENDENCY_LABELS: Record<string, string> = {
  database: 'Database',
  rabbitmq: 'Message broker',
};

/** Every service, what it is for, whether it is working and what it depends on. */
export function ServiceCards({ health }: { health: Resource<ServiceHealth> }) {
  if (!health.data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SERVICE_NAMES.map((service) => (
          <Skeleton key={service} className="h-36" />
        ))}
      </div>
    );
  }
  return (
    <ul
      className={cx('grid grid-cols-1 gap-3 md:grid-cols-2', health.refreshing && 'opacity-80')}
      aria-label="Services"
    >
      {SERVICE_NAMES.map((service) => {
        const result = health.data![service];
        const state = STATE[healthState(result)];
        const down = downDependencies(result);
        const checks = Object.entries(result.report?.checks ?? {});
        return (
          <li key={service} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">{SERVICE_LABELS[service]}</h3>
              <StatusBadge tone={state.tone}>{state.word}</StatusBadge>
            </div>
            <p className="mt-1 text-[13px] text-ink-3">{PURPOSE[service]}</p>
            <p className="mt-3 text-[13px] text-ink-2">
              {state.meaning}
              {down.length > 0
                ? ` Cannot reach: ${down.map((name) => (DEPENDENCY_LABELS[name] ?? name).toLowerCase()).join(', ')}.`
                : ''}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[13px]">
              <div>
                <dt className="text-ink-3">Response time</dt>
                <dd className="text-ink">{formatLatency(result.latencyMs)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Last checked</dt>
                <dd className="text-ink">{formatTime(result.checkedAt)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Depends on</dt>
                <dd className="text-ink">
                  {checks.length === 0
                    ? '—'
                    : checks.map(([name, check]) => (
                        <span key={name} className="block">
                          {DEPENDENCY_LABELS[name] ?? name}:{' '}
                          <span
                            className={
                              check.status === 'up' ? 'text-ink-2' : 'font-medium text-serious'
                            }
                          >
                            {check.status === 'up' ? 'up' : 'down'}
                          </span>
                        </span>
                      ))}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function Count({
  label,
  value,
  help,
  tone,
}: {
  label: string;
  value: number | null;
  help?: string;
  tone?: 'attention';
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[13px] text-ink-3">
        {label}
        {help ? <Help term={label}>{help}</Help> : null}
      </dt>
      <dd
        className={cx(
          'mt-0.5 text-xl font-semibold',
          tone === 'attention' && value ? 'text-serious' : 'text-ink',
        )}
      >
        {value === null ? (
          <span className="text-base text-ink-3">Not reported</span>
        ) : (
          formatCount(value)
        )}
      </dd>
    </div>
  );
}

function Since({
  diagnostics,
  service,
}: {
  diagnostics: ServiceDiagnostics;
  service: ServiceName;
}) {
  const result = diagnostics[service];
  if (result.snapshot) {
    return (
      <p className="text-xs text-ink-3">
        Counted since {SERVICE_LABELS[service].toLowerCase()} started,{' '}
        {formatDateTime(result.snapshot.countingSince)}.
      </p>
    );
  }
  return (
    <p className="text-xs text-serious">
      {SERVICE_LABELS[service]} did not report its counters. {result.error?.message}
    </p>
  );
}

function Stage({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <li className="min-w-0 rounded-md border border-line bg-raised/40 p-4">
      <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{step}</p>
      <h3 className="mt-0.5 text-[14px] font-semibold text-ink">{title}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-3">{children}</dl>
    </li>
  );
}

/**
 * The path a meter reading takes as an event: stored with the reading,
 * delivered to the message broker, and picked up by trade matching - with
 * what went wrong on the way. From the services' own counters; the broker's
 * queues themselves are not exposed to the dashboard.
 */
export function EventPipeline({ diagnostics }: { diagnostics: Resource<ServiceDiagnostics> }) {
  if (!diagnostics.data) {
    return diagnostics.status === 'error' ? (
      <p className="text-sm text-ink-2">
        Event counters are not available: {diagnostics.error?.message}
      </p>
    ) : (
      <LoadingBlock label="Loading the event counters" lines={4} />
    );
  }
  const meter = meterPipeline(diagnostics.data.smartMeter.snapshot);
  const events = eventProcessing(diagnostics.data.tradeMatching.snapshot);

  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Stage step="1 · Smart meter" title="Readings received">
          <Count label="New readings" value={meter.readingsNew} />
          <Count
            label="Repeats ignored"
            value={meter.readingsRepeated}
            help="A meter sent a reading it had already sent. It is stored once."
          />
        </Stage>
        <li aria-hidden="true" className="flex items-center justify-center text-ink-3">
          <ArrowRightIcon className="rotate-90 lg:rotate-0" />
        </li>
        <Stage step="2 · Outbox" title="Events sent to the broker">
          <Count
            label="Created"
            value={meter.eventsQueued}
            help="An event is saved together with its reading, so neither can exist without the other."
          />
          <Count label="Delivered" value={meter.eventsDelivered} />
          <Count
            label="Delivery attempts failed"
            value={meter.deliveryFailures}
            tone="attention"
            help="The broker did not accept an event. It stays saved and is tried again."
          />
          <Count
            label="Waiting now"
            value={meter.waitingNow}
            tone="attention"
            help="Events saved but not yet accepted by the broker."
          />
        </Stage>
        <li aria-hidden="true" className="flex items-center justify-center text-ink-3">
          <ArrowRightIcon className="rotate-90 lg:rotate-0" />
        </li>
        <Stage step="3 · Trade matching" title="Events processed">
          <Count label="Processed" value={events.processed} />
          <Count
            label="Duplicates ignored"
            value={events.duplicates}
            help="The same event arrived twice. It is recognised and used once."
          />
          <Count
            label="Retries scheduled"
            value={events.retries}
            help="Processing failed for a moment - usually a service it needed was busy - so it was tried again later."
          />
          <Count
            label="Set aside"
            value={events.deadLettered}
            tone="attention"
            help="Still failing after every retry, so it was moved to a separate queue (the dead-letter queue) for an operator to look at."
          />
          <Count
            label="Invalid, set aside"
            value={events.rejected}
            tone="attention"
            help="An event with missing or malformed content. Retrying cannot fix it, so it goes straight to the dead-letter queue."
          />
        </Stage>
      </ol>
      <Since diagnostics={diagnostics.data} service="smartMeter" />
      <Since diagnostics={diagnostics.data} service="tradeMatching" />
      <p className="text-xs text-ink-3">
        The message broker’s own queues and its management interface are not exposed to this
        dashboard; these figures are what the services counted themselves.
      </p>
    </div>
  );
}

/** Matching runs, trades reserved, what billing answered and what the ledger recorded. */
export function OperationsCounters({ diagnostics }: { diagnostics: Resource<ServiceDiagnostics> }) {
  if (!diagnostics.data) return <LoadingBlock label="Loading the counters" lines={4} />;
  const market = marketOperations(diagnostics.data.tradeMatching.snapshot);
  const ledger = ledgerOperations(diagnostics.data.billing.snapshot);
  const recalculations = total(diagnostics.data.pricing.snapshot, 'price_recalculations_total');

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card>
        <h3 className="text-[14px] font-semibold text-ink">Matching</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Count label="Runs completed" value={market.runsCompleted} />
          <Count
            label="Runs stopped: no price"
            value={market.runsWithoutPrice}
            tone="attention"
            help="Matching could not get a price from the pricing engine, so it made no trades that time."
          />
          <Count label="Runs failed" value={market.runsFailed} tone="attention" />
          <Count
            label="Trades reserved"
            value={market.tradesReserved}
            help="Energy set aside on both sides of a new trade before billing is asked."
          />
        </dl>
        <div className="mt-3">
          <Since diagnostics={diagnostics.data} service="tradeMatching" />
        </div>
      </Card>
      <Card>
        <h3 className="text-[14px] font-semibold text-ink">Billing answers to trade matching</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Count label="Settled" value={market.billingSettled} />
          <Count label="Refused" value={market.billingRefused} tone="attention" />
          <Count
            label="No answer"
            value={market.billingNoAnswer}
            tone="attention"
            help="Billing did not answer in time. The trade stays reserved and is asked about again later."
          />
          <Count
            label="Waiting now"
            value={market.awaitingBilling}
            help="Trades reserved and not yet confirmed by billing, right now."
          />
        </dl>
        <div className="mt-3">
          <Since diagnostics={diagnostics.data} service="tradeMatching" />
        </div>
      </Card>
      <Card>
        <h3 className="text-[14px] font-semibold text-ink">Ledger and prices</h3>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Count label="Trades recorded" value={ledger.recorded} />
          <Count
            label="Repeats answered"
            value={ledger.repeated}
            help="The same trade was sent again; the ledger answered from what it had already recorded."
          />
          <Count
            label="Conflicts refused"
            value={ledger.conflicts}
            tone="attention"
            help="A trade that clashed with one already recorded was refused."
          />
          <Count label="Price recalculations" value={recalculations} />
        </dl>
        <div className="mt-3 space-y-1">
          <Since diagnostics={diagnostics.data} service="billing" />
          <Since diagnostics={diagnostics.data} service="pricing" />
        </div>
      </Card>
    </div>
  );
}

const FAILURE_NAMES: Record<string, string> = {
  database: 'Database',
  rabbitmq: 'Message broker',
  pricing: 'Pricing engine',
  billing: 'Billing ledger',
};

/**
 * For engineers: HTTP traffic and dependency failures per service. Technical
 * names are in parentheses, next to the plain ones.
 */
export function EngineeringDiagnostics({
  diagnostics,
}: {
  diagnostics: Resource<ServiceDiagnostics>;
}) {
  if (!diagnostics.data) return <LoadingBlock label="Loading the diagnostics" lines={4} />;
  return (
    <div className="relative overflow-x-auto">
      <table className="figures w-full min-w-[46rem] border-collapse text-sm whitespace-nowrap">
        <caption className="sr-only">Requests and dependency failures per service</caption>
        <thead>
          <tr className="text-left text-[13px] text-ink-3">
            <th scope="col" className="pb-2 pr-3 font-medium">
              Service
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Requests
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Answered (2xx/3xx)
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Refused (4xx)
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Failed (5xx)
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Average time
            </th>
            <th scope="col" className="pb-2 font-medium">
              Times a dependency was unavailable
            </th>
          </tr>
        </thead>
        <tbody>
          {SERVICE_NAMES.map((service) => {
            const snapshot = diagnostics.data![service].snapshot;
            const http = httpSummary(snapshot);
            const failures = dependencyFailures(snapshot);
            const failureList = failures
              ? Object.entries(failures).filter(([, count]) => count > 0)
              : null;
            return (
              <tr key={service} className="border-t border-line">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">
                  {SERVICE_LABELS[service]}
                </th>
                {http ? (
                  <>
                    <td className="py-2.5 pr-3 text-right text-ink">
                      {formatCount(http.requests)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">
                      {formatCount(http.succeeded)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">
                      {formatCount(http.refused)}
                    </td>
                    <td
                      className={cx(
                        'py-2.5 pr-3 text-right',
                        http.failed > 0 ? 'font-medium text-serious' : 'text-ink-2',
                      )}
                    >
                      {formatCount(http.failed)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">
                      {formatLatency(http.averageMs)}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="py-2.5 pr-3 text-ink-3">
                    Not reported
                    {diagnostics.data![service].error
                      ? `: ${diagnostics.data![service].error!.message}`
                      : ''}
                  </td>
                )}
                <td className="py-2.5 text-[13px] text-ink-2">
                  {failureList === null
                    ? '—'
                    : failureList.length === 0
                      ? 'None'
                      : failureList
                          .map(
                            ([dependency, count]) =>
                              `${FAILURE_NAMES[dependency] ?? dependency}: ${formatCount(count)}`,
                          )
                          .join(' · ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-ink-3">
        Every figure counts from when its service last started, and includes health checks. Source:
        each service’s <code className="font-mono">GET /diagnostics</code>, the same counters as{' '}
        <code className="font-mono">/metrics</code>.
      </p>
    </div>
  );
}
