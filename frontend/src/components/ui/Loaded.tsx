import type { ReactNode } from 'react';
import type { Resource } from '../../hooks/use-resource';
import { cx, ErrorState } from './primitives';

/**
 * Loading, failed or ready, the same way everywhere: a placeholder the size
 * of what is coming, a plain message naming what could not be loaded, or the
 * content - dimmed while a newer answer is on its way.
 */
export function Loaded<T>({
  resource,
  what,
  height = 64,
  children,
}: {
  resource: Resource<T>;
  /** "energy statistics": finishes "Loading …" and "Unable to load …". */
  what: string;
  /** Height of the placeholder, in pixels. */
  height?: number;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading') {
    return (
      <div role="status">
        <span className="sr-only">Loading {what}</span>
        <div aria-hidden="true" className="animate-pulse rounded bg-raised" style={{ height }} />
      </div>
    );
  }
  if (resource.status === 'error' || resource.data === null) {
    return (
      <ErrorState
        title={`Unable to load ${what}.`}
        error={resource.error}
        retrying={resource.refreshing}
      />
    );
  }
  return (
    <div
      aria-busy={resource.refreshing || undefined}
      className={cx('transition-opacity', resource.refreshing && 'opacity-70')}
    >
      {children(resource.data)}
    </div>
  );
}
