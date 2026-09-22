import type { PricingBand } from '../../types/api';
import { groupDigits, toChartNumber } from '../../utils/format';
import { SERIES } from '../charts/chart-theme';
import { Help } from '../ui/layout';

interface Marker {
  label: string;
  value: string | null;
}

/**
 * Where the price sits in the range the pricing rule allows: the floor on the
 * left, the ceiling on the right, the current price marked between them, and
 * the average prices of the period beside it. Positions are drawn from the
 * numbers; every label shows the exact figure.
 */
export function PriceBand({
  band,
  current,
  unit,
  observedLow,
  observedHigh,
  markers,
}: {
  band: PricingBand | null;
  current: string;
  unit: string;
  /** The lowest and highest price calculated in the period, shaded on the band. */
  observedLow: string | null;
  observedHigh: string | null;
  markers: Marker[];
}) {
  if (!band) {
    return (
      <p className="text-sm text-ink-2">
        No pricing rule is active, so there is no floor or ceiling to show the price against.
      </p>
    );
  }

  const floor = toChartNumber(band.minPrice) ?? 0;
  const cap = toChartNumber(band.maxPrice) ?? 0;
  const span = cap - floor;
  const position = (value: string | null) => {
    const number = toChartNumber(value);
    if (number === null || span <= 0) return null;
    return Math.min(100, Math.max(0, ((number - floor) / span) * 100));
  };
  const currentAt = position(current);
  const low = position(observedLow);
  const high = position(observedHigh);
  const placed = markers
    .map((marker) => ({ ...marker, at: position(marker.value) }))
    .filter((marker): marker is Marker & { at: number } => marker.at !== null);

  return (
    <figure
      className="space-y-3"
      aria-label={`Current price ${groupDigits(current)} ${unit}, in a range from ${groupDigits(band.minPrice)} to ${groupDigits(band.maxPrice)} ${unit}`}
    >
      <div className="relative pt-9 pb-2">
        {currentAt !== null ? (
          <div
            className="absolute top-0 -translate-x-1/2 text-center"
            style={{ left: `clamp(3.5rem, ${currentAt}%, calc(100% - 3.5rem))` }}
          >
            <p className="text-[13px] font-semibold whitespace-nowrap text-ink">
              Now {groupDigits(current)}
            </p>
          </div>
        ) : null}
        <div className="relative h-3 rounded-full bg-raised">
          {low !== null && high !== null ? (
            <span
              className="absolute inset-y-0 rounded-full"
              style={{
                left: `${low}%`,
                width: `${Math.max(1, high - low)}%`,
                background: SERIES.price,
                opacity: 0.35,
              }}
            />
          ) : null}
          {placed.map((marker) => (
            <span
              key={marker.label}
              aria-hidden="true"
              className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-2 ring-2 ring-surface"
              style={{ left: `${marker.at}%` }}
            />
          ))}
          {currentAt !== null ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-surface"
              style={{ left: `${currentAt}%`, background: SERIES.price }}
            />
          ) : null}
        </div>
      </div>
      <div className="flex justify-between text-[13px]">
        <span>
          <span className="text-ink-3">Floor </span>
          <span className="font-medium text-ink">{groupDigits(band.minPrice)}</span>
        </span>
        <span className="text-ink-3">
          Base <span className="font-medium text-ink-2">{groupDigits(band.basePrice)}</span>
        </span>
        <span>
          <span className="text-ink-3">Ceiling </span>
          <span className="font-medium text-ink">{groupDigits(band.maxPrice)}</span>
        </span>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full"
            style={{ background: SERIES.price }}
          />
          Current price
        </span>
        {placed.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink-2" />
            {placed.map((marker) => `${marker.label} ${groupDigits(marker.value)}`).join(' · ')}
          </span>
        ) : null}
        {low !== null && high !== null ? (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-4 rounded-sm"
              style={{ background: SERIES.price, opacity: 0.35 }}
            />
            Lowest to highest this period
          </span>
        ) : null}
        <Help term="the price range">
          The pricing rule never sets a price below the floor or above the ceiling. Within them, the
          price rises when demand is higher than supply and falls when supply is higher.
        </Help>
      </figcaption>
    </figure>
  );
}
