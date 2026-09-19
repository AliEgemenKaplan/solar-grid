import { useEffect, useEffectEvent } from 'react';

/**
 * Calls `onTick` every `intervalMs` while enabled - but not while the previous
 * refresh is still running, and not while the tab is hidden, so a dashboard
 * left open in a background tab does not keep polling four services.
 */
export function useAutoRefresh(
  enabled: boolean,
  intervalMs: number,
  busy: boolean,
  onTick: () => void,
): void {
  const tick = useEffectEvent(() => {
    if (busy) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    onTick();
  });

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
}
