/**
 * The values the charts draw with. Read from the same custom properties as the
 * rest of the interface (see styles/index.css), so a colour is defined once.
 */
export const SERIES = {
  production: 'var(--color-production)',
  consumption: 'var(--color-consumption)',
  net: 'var(--color-net)',
  traded: 'var(--color-traded)',
  volume: 'var(--color-volume)',
  price: 'var(--color-price)',
} as const;

export const CHROME = {
  surface: 'var(--color-surface)',
  grid: 'var(--color-grid)',
  axis: 'var(--color-line)',
  tick: 'var(--color-ink-3)',
  crosshair: 'var(--color-ink-3)',
} as const;

export const AXIS_TICK = { fill: CHROME.tick, fontSize: 11 } as const;

/** Thin and round-ended, drawn once: no entrance animation on every refresh. */
export const LINE = { strokeWidth: 2, isAnimationActive: false, strokeLinecap: 'round' } as const;

/** The hovered point: a filled dot with a ring in the surface colour. */
export function activeDot(color: string) {
  return { r: 4, fill: color, stroke: CHROME.surface, strokeWidth: 2 };
}

const AXIS_NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const AXIS_COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Axis ticks are positions on a scale, not reported values, so rounding them is fine. */
export function formatAxisNumber(value: number): string {
  return Math.abs(value) >= 10_000 ? AXIS_COMPACT.format(value) : AXIS_NUMBER.format(value);
}

/** Show a dot on every point when there are few enough that one reads as a point, not noise. */
export function sparseDots(pointsWithValues: number, color: string) {
  return pointsWithValues <= 48
    ? { r: 3, fill: color, stroke: CHROME.surface, strokeWidth: 1.5 }
    : false;
}

/** Room reserved at the right of a chart so the last tick label is not clipped. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;
