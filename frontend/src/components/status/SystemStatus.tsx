import type { PageId } from '../../app/routes';
import { SERVICE_LABELS, SERVICE_NAMES } from '../../config/config';
import type { Resource } from '../../hooks/use-resource';
import type { ServiceHealth } from '../../hooks/use-service-health';
import type { Issue, Severity } from '../../utils/attention';
import { healthState, systemStatus, type SystemState } from '../../utils/system-status';
import { ArrowRightIcon, CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from '../ui/icons';
import { cx, Skeleton, StatusBadge, type Tone } from '../ui/primitives';

const STATE: Record<SystemState, { tone: Tone; headline: string; icon: typeof CheckIcon }> = {
  checking: { tone: 'neutral', headline: 'Checking the services…', icon: InfoIcon },
  operational: { tone: 'good', headline: 'All systems operational', icon: CheckIcon },
  degraded: { tone: 'warning', headline: 'System degraded', icon: WarningIcon },
  down: { tone: 'critical', headline: 'System unavailable', icon: ErrorIcon },
};

const FRAME: Record<Tone, string> = {
  good: 'border-good/40 bg-good/[0.06]',
  warning: 'border-warning/40 bg-warning/[0.06]',
  critical: 'border-critical/50 bg-critical/[0.08]',
  neutral: 'border-line bg-surface',
};

const ICON: Record<Tone, string> = {
  good: 'text-good',
  warning: 'text-warning',
  critical: 'text-critical',
  neutral: 'text-ink-3',
};

const SERVICE_STATE = {
  ready: { tone: 'good', word: 'Ready' },
  degraded: { tone: 'warning', word: 'Degraded' },
  unreachable: { tone: 'critical', word: 'Unavailable' },
} as const;

/**
 * The first thing on the overview: is the grid working, in words anyone can
 * read, with each service named beside its own state.
 */
export function SystemStatusBanner({
  health,
  onOpen,
}: {
  health: Resource<ServiceHealth>;
  /** Opens the system health page; left out on that page itself. */
  onOpen?: () => void;
}) {
  const status = systemStatus(health.data);
  const { tone, headline, icon: Icon } = STATE[status.state];

  return (
    <section aria-label="System status" className={cx('rounded-lg border px-5 py-4', FRAME[tone])}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon width={28} height={28} className={ICON[tone]} />
          <div>
            <p className="text-xl font-semibold tracking-tight text-ink">{headline}</p>
            <p className="text-sm text-ink-2">
              {status.state === 'checking'
                ? 'Asking each service whether it is ready.'
                : `${status.ready} of ${status.total} services ready`}
            </p>
          </div>
        </div>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-raised hover:text-ink"
          >
            Service details
            <ArrowRightIcon />
          </button>
        ) : null}
      </div>
      {health.data ? (
        <ul
          className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Services at a glance"
        >
          {SERVICE_NAMES.map((service) => {
            const state = SERVICE_STATE[healthState(health.data![service])];
            return (
              <li key={service} className="flex items-center gap-3 text-[13px]">
                <span className="text-ink">{SERVICE_LABELS[service]}</span>
                <StatusBadge tone={state.tone}>{state.word}</StatusBadge>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SERVICE_NAMES.map((service) => (
            <Skeleton key={service} className="h-5" />
          ))}
        </div>
      )}
    </section>
  );
}

/** The same verdict, small, for the top bar on every page. */
export function SystemStatusPill({ health }: { health: Resource<ServiceHealth> }) {
  const status = systemStatus(health.data);
  const { tone } = STATE[status.state];
  const word =
    status.state === 'checking'
      ? 'Checking…'
      : status.state === 'operational'
        ? 'All systems operational'
        : `${status.state === 'down' ? 'Unavailable' : 'Degraded'} · ${status.ready}/${status.total} ready`;
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2.5 py-1', FRAME[tone])}>
      <StatusBadge tone={tone}>{word}</StatusBadge>
    </span>
  );
}

const SEVERITY: Record<Severity, { tone: Tone; word: string; icon: typeof CheckIcon }> = {
  critical: { tone: 'critical', word: 'Critical', icon: ErrorIcon },
  warning: { tone: 'warning', word: 'Warning', icon: WarningIcon },
  info: { tone: 'neutral', word: 'Notice', icon: InfoIcon },
};

const PAGE_NAMES: Record<PageId, string> = {
  overview: 'Overview',
  energy: 'Energy',
  market: 'Market',
  trading: 'Trading',
  billing: 'Billing',
  households: 'Households',
  system: 'System health',
};

/**
 * What needs someone's attention, most serious first, each with what it
 * means and where to look. Says plainly when there is nothing.
 */
export function AttentionPanel({
  issues,
  checking,
  onOpen,
  here,
}: {
  issues: Issue[];
  checking: boolean;
  onOpen: (page: PageId) => void;
  /** The page it is shown on, which needs no link to itself. */
  here?: PageId;
}) {
  if (checking) {
    return (
      <section aria-label="Issues" className="rounded-lg border border-line bg-surface px-5 py-4">
        <p role="status" className="text-sm text-ink-3">
          Looking for problems…
        </p>
      </section>
    );
  }
  if (issues.length === 0) {
    return (
      <section aria-label="Issues" className="rounded-lg border border-line bg-surface px-5 py-4">
        <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
          <CheckIcon className="text-good" />
          No issues detected
        </p>
        <p className="mt-1 text-[13px] text-ink-3">
          Every service reports ready, and nothing the dashboard checks - the books, trade outcomes,
          waiting or failed events - needs attention.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Issues" className="rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold text-ink">
        Attention required
        <span className="ml-2 text-[13px] font-normal text-ink-3">
          {issues.length} {issues.length === 1 ? 'item' : 'items'}
        </span>
      </h2>
      <ul className="divide-y divide-line">
        {issues.map((issue) => {
          const severity = SEVERITY[issue.severity];
          const Icon = severity.icon;
          return (
            <li
              key={issue.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
            >
              <div className="flex min-w-0 gap-3">
                <Icon className={cx('mt-0.5 shrink-0', ICON[severity.tone])} />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">
                    <span className="sr-only">{severity.word}: </span>
                    {issue.title}
                  </p>
                  {issue.impact ? (
                    <p className="mt-0.5 text-[13px] text-ink-2">{issue.impact}</p>
                  ) : null}
                </div>
              </div>
              {issue.page === here ? null : (
                <button
                  type="button"
                  onClick={() => onOpen(issue.page)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] text-ink-2 hover:bg-raised hover:text-ink"
                >
                  {PAGE_NAMES[issue.page]}
                  <ArrowRightIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
