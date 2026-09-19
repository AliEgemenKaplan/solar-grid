import type { ReactNode } from 'react';
import type { MarketSection } from '../../hooks/use-dashboard-data';
import type { Resource } from '../../hooks/use-resource';
import type { BookStats } from '../../types/api';
import { formatCount, groupDigits, toChartNumber } from '../../utils/format';
import { SERIES } from '../charts/chart-theme';
import { EmptyState, ErrorState, LoadingBlock, Panel, StatusBadge } from '../ui/primitives';

/**
 * The order book and what became of it: how much energy was offered and
 * requested, how much of it found a counterparty, and how the resulting trades
 * ended. Every figure is the API's; the bars only draw its proportions.
 */
export function MarketActivity({ market }: { market: Resource<MarketSection> }) {
  return (
    <Panel
      title="Market activity"
      subtitle="Offers and requests created in the window, with their state as it stands now"
      refreshing={market.refreshing}
    >
      {market.status === 'loading' ? (
        <LoadingBlock label="Loading market statistics" lines={5} />
      ) : market.status === 'error' || !market.data ? (
        <ErrorState
          title="Unable to load market statistics."
          error={market.error}
          retrying={market.refreshing}
        />
      ) : market.data.summary.offers.total +
          market.data.summary.requests.total +
          market.data.summary.trades.total ===
        0 ? (
        <EmptyState title="No trading activity in the selected period.">
          Offers and requests appear here as households report surplus or demand.
        </EmptyState>
      ) : (
        <MarketBody summary={market.data.summary} />
      )}
    </Panel>
  );
}

function MarketBody({ summary }: { summary: MarketSection['summary'] }) {
  const { trades } = summary;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Book title="Supply offered" book={summary.offers} color={SERIES.production} />
        <Book title="Demand requested" book={summary.requests} color={SERIES.consumption} />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-ink-3">Trades created in the window</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Outcome label="Total" value={trades.total} />
          <Outcome
            label="Settled"
            value={trades.completed}
            badge={
              trades.completed > 0 ? (
                <StatusBadge tone="good">Billed and recorded</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">None yet</StatusBadge>
              )
            }
          />
          <Outcome
            label="Pending billing"
            value={trades.pendingBilling}
            badge={
              trades.pendingBilling > 0 ? (
                <StatusBadge tone="warning">Awaiting billing</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">None waiting</StatusBadge>
              )
            }
          />
          <Outcome
            label="Failed"
            value={trades.failed}
            badge={
              trades.failed > 0 ? (
                <StatusBadge tone="critical">Refused by billing</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">None failed</StatusBadge>
              )
            }
          />
        </dl>
        {trades.pendingBilling > 0 ? (
          <p className="mt-2 text-xs text-ink-3">
            {groupDigits(summary.pending.energyKwh)} kWh worth {groupDigits(summary.pending.volume)}{' '}
            {summary.currency} is reserved and waiting for a billing answer.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Book({ title, book, color }: { title: string; book: BookStats; color: string }) {
  const total = toChartNumber(book.totalKwh) ?? 0;
  const matched = toChartNumber(book.matchedKwh) ?? 0;
  const open = toChartNumber(book.openKwh) ?? 0;
  // Proportions for drawing only; the figures beside the bar are the API's.
  const matchedShare = total > 0 ? (matched / total) * 100 : 0;
  const openShare = total > 0 ? (open / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-3">{title}</h3>
        <p className="figures text-sm font-semibold text-ink">
          {groupDigits(book.totalKwh)} <span className="text-xs font-normal text-ink-3">kWh</span>
        </p>
      </div>

      <div
        className="mt-2 flex h-2 w-full gap-0.5 overflow-hidden rounded-sm bg-raised"
        role="img"
        aria-label={`${groupDigits(book.matchedKwh)} kWh matched and ${groupDigits(book.openKwh)} kWh still open, of ${groupDigits(book.totalKwh)} kWh`}
      >
        {matchedShare > 0 ? (
          <span style={{ width: `${matchedShare}%`, background: color }} />
        ) : null}
        {openShare > 0 ? (
          <span style={{ width: `${openShare}%`, background: color, opacity: 0.35 }} />
        ) : null}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-ink-3">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: color }} />
            Matched
          </dt>
          <dd className="figures text-ink-2">{groupDigits(book.matchedKwh)} kWh</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-ink-3">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-sm"
              style={{ background: color, opacity: 0.35 }}
            />
            Still open
          </dt>
          <dd className="figures text-ink-2">{groupDigits(book.openKwh)} kWh</dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-2 text-xs">
        {(
          [
            ['Open', book.open],
            ['Partial', book.partiallyMatched],
            ['Matched', book.matched],
            ['Cancelled', book.cancelled],
          ] as const
        ).map(([label, count]) => (
          <div key={label}>
            <dt className="text-ink-3">{label}</dt>
            <dd className="figures text-ink-2">{formatCount(count)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Outcome({ label, value, badge }: { label: string; value: number; badge?: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-raised/40 px-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-ink">{formatCount(value)}</dd>
      {badge ? <dd className="mt-0.5">{badge}</dd> : null}
    </div>
  );
}
