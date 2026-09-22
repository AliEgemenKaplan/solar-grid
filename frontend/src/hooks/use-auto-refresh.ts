import { useEffect, useEffectEvent } from 'react';

/**
 * Calls `onTick` every `intervalMs` while enabled - but not while the previous
 * refresh is still running, and not while the tab is hidden, so a dashboard
 * left open in a background tab does not keep polling four services. Coming
 * back to a tab that was hidden for longer than one interval refreshes at
 * once, rather than showing old figures until the next tick.
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
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= intervalMs) tick();
        hiddenAt = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
