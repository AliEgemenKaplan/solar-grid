import type { Resource } from '../../hooks/use-resource';
import type { ServiceHealth } from '../../hooks/use-service-health';
import { formatTime } from '../../utils/format';
import { GridMark, RefreshIcon, SignOutIcon } from '../ui/icons';
import { Button, cx } from '../ui/primitives';
import { HealthSummary } from './ServiceHealthPanel';

/**
 * Brand, the state of the grid at a glance, and the controls that act on the
 * whole page: refresh now, refresh on a timer, sign out.
 */
export function DashboardHeader({
  health,
  lastUpdated,
  busy,
  autoRefresh,
  autoRefreshSeconds,
  onRefresh,
  onToggleAutoRefresh,
  onSignOut,
}: {
  health: Resource<ServiceHealth>;
  lastUpdated: Date | null;
  busy: boolean;
  autoRefresh: boolean;
  autoRefreshSeconds: number;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <GridMark />
          <div>
            <p className="text-[15px] font-semibold leading-tight tracking-tight text-ink">
              SolarGrid
            </p>
            <p className="text-xs text-ink-3">Energy Trading &amp; Distributed Grid</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1">
          {health.data ? (
            <HealthSummary health={health.data} />
          ) : (
            <span className="text-xs text-ink-3">Checking services…</span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-3" aria-live="polite">
            {busy
              ? 'Updating…'
              : lastUpdated
                ? `Updated ${formatTime(lastUpdated)}`
                : 'Not updated yet'}
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={onToggleAutoRefresh}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-ink-2 hover:bg-raised"
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
            Auto refresh {autoRefreshSeconds}s
          </button>

          <Button onClick={onRefresh} aria-label="Refresh all statistics now">
            <RefreshIcon className={cx(busy && 'animate-spin')} />
            Refresh
          </Button>

          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

          <span className="hidden text-xs text-ink-3 sm:inline">Operator</span>
          <Button variant="ghost" onClick={onSignOut}>
            <SignOutIcon />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
