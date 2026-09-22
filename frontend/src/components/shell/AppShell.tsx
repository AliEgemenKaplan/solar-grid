import { useEffect, useRef, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { hashFor, PAGES, type PageId } from '../../app/routes';
import type { Resource } from '../../hooks/use-resource';
import type { ServiceHealth } from '../../hooks/use-service-health';
import { useNow } from '../../hooks/use-now';
import type { Issue, Severity } from '../../utils/attention';
import { formatAgo, formatTime } from '../../utils/format';
import { SystemStatusPill } from '../status/SystemStatus';
import {
  BillingIcon,
  EnergyIcon,
  GridMark,
  HouseholdIcon,
  MarketIcon,
  OverviewIcon,
  RefreshIcon,
  SignOutIcon,
  SystemIcon,
  TradingIcon,
} from '../ui/icons';
import { Button, cx } from '../ui/primitives';

const PAGE_ICONS: Record<PageId, ComponentType<SVGProps<SVGSVGElement>>> = {
  overview: OverviewIcon,
  energy: EnergyIcon,
  market: MarketIcon,
  trading: TradingIcon,
  billing: BillingIcon,
  households: HouseholdIcon,
  system: SystemIcon,
};

const BADGE_STYLES: Record<Severity, string> = {
  critical: 'bg-critical text-white',
  warning: 'bg-warning text-canvas',
  info: 'bg-raised text-ink-2 border border-line',
};

export interface ShellControls {
  health: Resource<ServiceHealth>;
  issues: Issue[];
  lastUpdated: Date | null;
  busy: boolean;
  autoRefresh: boolean;
  autoRefreshSeconds: number;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  onSignOut: () => void;
}

/**
 * The frame around every page: navigation (a sidebar on wide screens, a row
 * of tabs on narrow ones - the same links either way), and a bar with the
 * state of the system, how fresh the figures are and the controls that act
 * on all of them.
 */
export function AppShell({
  page,
  controls,
  children,
}: {
  page: PageId;
  controls: ShellControls;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a
        href="#main"
        onClick={(event) => {
          // The address holds the page, so the skip link moves focus instead of the hash.
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to the content
      </a>

      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2 lg:px-5 lg:pt-5 lg:pb-5">
          <GridMark />
          <div>
            <p className="text-[15px] leading-tight font-semibold tracking-tight text-ink">
              SolarGrid
            </p>
            <p className="text-xs text-ink-3">Operator control center</p>
          </div>
        </div>
        <Navigation page={page} issues={controls.issues} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <TopBar controls={controls} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 outline-none sm:px-6"
        >
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-3 text-xs text-ink-3 sm:px-6">
            <p>Every figure is computed by the services and shown exactly as they report it.</p>
            <p>SolarGrid operator control center</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Navigation({ page, issues }: { page: PageId; issues: Issue[] }) {
  const currentLink = useRef<HTMLAnchorElement>(null);
  // On a phone the tabs scroll sideways; keep the open page's tab in view.
  useEffect(() => {
    currentLink.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [page]);
  return (
    <nav aria-label="Pages" className="lg:flex-1 lg:overflow-y-auto">
      <ul className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] after:w-1 after:shrink-0 after:content-[''] lg:flex-col lg:after:hidden lg:overflow-visible lg:px-3 lg:pb-3 [&::-webkit-scrollbar]:hidden">
        {PAGES.map((entry) => {
          const Icon = PAGE_ICONS[entry.id];
          const current = entry.id === page;
          const own = issues.filter((issue) => issue.page === entry.id);
          const worst = own[0]?.severity;
          return (
            <li key={entry.id} className="shrink-0">
              <a
                ref={current ? currentLink : undefined}
                href={hashFor(entry.id)}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  current
                    ? 'bg-raised text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
                    : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
                )}
              >
                <Icon className={current ? 'text-accent' : 'text-ink-3'} />
                <span>{entry.label}</span>
                {worst ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={cx(
                        'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                        BADGE_STYLES[worst],
                      )}
                    >
                      {own.length}
                    </span>
                    <span className="sr-only">
                      , {own.length} {own.length === 1 ? 'item' : 'items'} to look at
                    </span>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TopBar({ controls }: { controls: ShellControls }) {
  const {
    health,
    lastUpdated,
    busy,
    autoRefresh,
    autoRefreshSeconds,
    onRefresh,
    onToggleAutoRefresh,
    onSignOut,
  } = controls;
  return (
    <header className="border-b border-line bg-canvas/95 backdrop-blur lg:sticky lg:top-0 lg:z-30">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <a href={hashFor('system')} className="rounded-full">
          <SystemStatusPill health={health} />
          <span className="sr-only">: see service details</span>
        </a>
        <Freshness lastUpdated={lastUpdated} busy={busy} />

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={onToggleAutoRefresh}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 hover:bg-raised"
          >
            <span
              aria-hidden="true"
              className={cx(
                'relative inline-block h-4 w-7 rounded-full border transition-colors',
                autoRefresh ? 'border-accent bg-accent/30' : 'border-line bg-raised',
              )}
            >
              <span
                className={cx(
                  'absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all',
                  autoRefresh ? 'left-3.5 bg-accent' : 'left-0.5 bg-ink-3',
                )}
              />
            </span>
            Auto refresh{' '}
            <span className="hidden text-ink-3 sm:inline">every {autoRefreshSeconds} s</span>
          </button>
          <Button onClick={onRefresh} aria-label="Refresh all figures now">
            <RefreshIcon className={cx(busy && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="ghost" onClick={onSignOut}>
            <SignOutIcon />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * "Updated 12 s ago", re-read every second by this line alone so the rest
 * of the page does not re-render with the clock.
 */
function Freshness({ lastUpdated, busy }: { lastUpdated: Date | null; busy: boolean }) {
  const now = useNow(1000);
  return (
    <p className="text-[13px] text-ink-3">
      {busy ? (
        <span role="status">Updating…</span>
      ) : lastUpdated ? (
        <>
          Updated <span className="text-ink-2">{formatAgo(lastUpdated, now)}</span>
          <span className="hidden sm:inline"> · {formatTime(lastUpdated)}</span>
        </>
      ) : (
        'Not updated yet'
      )}
    </p>
  );
}
