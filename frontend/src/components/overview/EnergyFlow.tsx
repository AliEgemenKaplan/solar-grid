import type { ReactNode } from 'react';
import type { EnergySection, MarketSection } from '../../hooks/use-dashboard-data';
import type { Resource } from '../../hooks/use-resource';
import { groupDigits, isZero, toChartNumber } from '../../utils/format';
import { SERIES } from '../charts/chart-theme';
import { Help, SplitBar } from '../ui/layout';
import { cx, Skeleton } from '../ui/primitives';

/**
 * Where the energy goes, left to right: households make it, the spare part is
 * offered to neighbours, the market matches offers with requests, and
 * neighbours who need energy asked for it and use it.
 *
 * Every number is one the services report: production and use from the
 * meters, offers, requests and trades from the market. Nothing is derived
 * here, and a figure the dashboard could not load says so instead of
 * appearing as zero.
 */
export function EnergyFlow({
  period,
  energy,
  market,
}: {
  period: string;
  energy: Resource<EnergySection>;
  market: Resource<MarketSection>;
}) {
  const e = energy.data?.summary;
  const m = market.data?.summary;
  const loading = energy.status === 'loading' || market.status === 'loading';

  return (
    <section
      aria-labelledby="energy-flow-title"
      className="rounded-lg border border-line bg-surface"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <h2 id="energy-flow-title" className="text-[15px] font-semibold text-ink">
          Energy flow
        </h2>
        <p className="text-[13px] text-ink-3">{period}</p>
      </div>
      <p className="px-5 pt-4 text-[13px] text-ink-2">
        Households with spare solar energy <strong className="font-medium text-ink">offer</strong>{' '}
        it; households that need energy <strong className="font-medium text-ink">ask</strong> for
        it; the market <strong className="font-medium text-ink">matches</strong> the two.
      </p>

      {loading ? (
        <div className="grid gap-3 p-5 md:grid-cols-5" role="status">
          <span className="sr-only">Loading the energy flow</span>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <ol className="grid grid-cols-1 items-stretch gap-2 p-5 xl:grid-cols-[1fr_auto_1fr_auto_1.2fr_auto_1fr_auto_1fr]">
          <Node
            label="Produced"
            color={SERIES.production}
            value={e ? groupDigits(e.productionKwh) : null}
            caption="by household solar panels"
            help="Everything the panels generated. Each household uses its own energy first; only what is left over is offered."
          />
          <Arrow direction="right" />
          <Node
            label="Offered"
            color={SERIES.production}
            value={m ? groupDigits(m.offers.totalKwh) : null}
            caption="spare energy put up for sale"
            help="Energy households had left over after their own use, offered to neighbours."
            detail={
              m ? (
                <Split
                  label="of the offered energy"
                  matched={m.offers.matchedKwh}
                  open={m.offers.openKwh}
                  color={SERIES.production}
                  openWord="still unsold"
                />
              ) : null
            }
          />
          <Arrow direction="right" />
          <Node
            emphasis
            label="Traded"
            color={SERIES.traded}
            value={m ? groupDigits(m.completed.energyKwh) : null}
            caption="sold between neighbours and settled"
            help="Energy that changed hands: matched, billed and recorded in the ledger."
            detail={
              m ? (
                isZero(m.pending.energyKwh) ? (
                  <p className="text-[13px] text-ink-3">Nothing waiting for billing.</p>
                ) : (
                  <p className="text-[13px] text-ink-2">
                    {groupDigits(m.pending.energyKwh)} kWh committed to trades, waiting for billing.
                  </p>
                )
              ) : null
            }
          />
          <Arrow direction="left" />
          <Node
            label="Requested"
            color={SERIES.consumption}
            value={m ? groupDigits(m.requests.totalKwh) : null}
            caption="energy households asked to buy"
            help="Energy households needed beyond what their own panels gave them, asked for from neighbours."
            detail={
              m ? (
                <Split
                  label="of the requested energy"
                  matched={m.requests.matchedKwh}
                  open={m.requests.openKwh}
                  color={SERIES.consumption}
                  openWord="still unmet"
                />
              ) : null
            }
          />
          <Arrow direction="left" />
          <Node
            label="Used"
            color={SERIES.consumption}
            value={e ? groupDigits(e.consumptionKwh) : null}
            caption="by the households"
            help="Everything the households used, from their own panels and from neighbours."
          />
        </ol>
      )}

      <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
        Produced and used come from the meter readings; offered, traded and requested come from the
        market.{' '}
        {energy.status === 'error' || market.status === 'error'
          ? 'Figures marked "Not available" could not be loaded.'
          : ''}
      </p>
    </section>
  );
}

function Node({
  label,
  value,
  caption,
  help,
  color,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string | null;
  caption: string;
  help: string;
  color: string;
  detail?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <li
      className={cx(
        'flex min-w-0 flex-col rounded-md border px-4 py-3',
        emphasis ? 'border-traded/50 bg-traded/[0.07]' : 'border-line bg-raised/40',
      )}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: color }} />
        {label}
        <Help term={label}>{help}</Help>
      </p>
      {value === null ? (
        <p className="mt-2 text-base font-semibold text-ink-3">Not available</p>
      ) : (
        <p
          className={cx(
            'mt-1.5 font-semibold tracking-tight text-ink',
            emphasis ? 'text-[28px]' : 'text-2xl',
          )}
        >
          {value}
          <span className="ml-1 text-sm font-medium text-ink-3">kWh</span>
        </p>
      )}
      <p className="mt-0.5 text-[13px] text-ink-3">{caption}</p>
      {detail ? <div className="mt-3">{detail}</div> : null}
    </li>
  );
}

function Split({
  label,
  matched,
  open,
  color,
  openWord,
}: {
  label: string;
  matched: string;
  open: string;
  color: string;
  openWord: string;
}) {
  return (
    <div className="space-y-1.5">
      <SplitBar
        label={`${groupDigits(matched)} kWh matched and ${groupDigits(open)} kWh ${openWord}, ${label}`}
        parts={[
          { label: 'matched', value: toChartNumber(matched) ?? 0, color },
          { label: openWord, value: toChartNumber(open) ?? 0, color, faded: true },
        ]}
      />
      <p className="text-[13px] text-ink-2">
        {groupDigits(matched)} matched · {groupDigits(open)} {openWord}
      </p>
    </div>
  );
}

/**
 * An arrow between two steps. Supply flows towards the market from the left,
 * demand from the right; when the steps stack on a narrow screen the arrows
 * turn to point at the market from above and below.
 */
function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <li aria-hidden="true" className="flex items-center justify-center text-lg text-ink-3">
      <span className="xl:hidden">{direction === 'right' ? '↓' : '↑'}</span>
      <span className="hidden xl:inline">{direction === 'right' ? '→' : '←'}</span>
    </li>
  );
}
