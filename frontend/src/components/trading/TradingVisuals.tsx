import type { BookStats, TradeSummary } from '../../types/api';
import { formatCount, formatShare, groupDigits, isZero, toChartNumber } from '../../utils/format';
import { Help, SplitBar } from '../ui/layout';
import { StatusBadge, type Tone } from '../ui/primitives';

const OUTCOME_COLORS = {
  settled: 'var(--color-good)',
  waiting: 'var(--color-warning)',
  refused: 'var(--color-critical)',
};

/**
 * How the trades of the period ended, as parts of one bar and as a list:
 * every outcome with its count, its share and what it means. A trade is
 * exactly one of the three, so they add up to the total.
 */
export function TradeOutcomes({
  summary,
  compact = false,
}: {
  summary: TradeSummary;
  /** One line per outcome instead of a card each, for the overview. */
  compact?: boolean;
}) {
  const { total, completed, pendingBilling, failed } = summary.trades;
  if (total === 0) {
    return <p className="text-sm text-ink-2">No trades were made in this period.</p>;
  }
  const outcomes: Array<{
    key: keyof typeof OUTCOME_COLORS;
    label: string;
    tone: Tone;
    count: number;
    meaning: string;
  }> = [
    {
      key: 'settled',
      label: 'Settled',
      tone: 'good',
      count: completed,
      meaning: 'Billed and recorded in the ledger. Finished.',
    },
    {
      key: 'waiting',
      label: 'Waiting for billing',
      tone: 'warning',
      count: pendingBilling,
      meaning: 'Energy is committed to the trade; billing has not confirmed it yet.',
    },
    {
      key: 'refused',
      label: 'Refused',
      tone: 'critical',
      count: failed,
      meaning: 'Billing refused the trade, so its energy went back to the market.',
    },
  ];

  return (
    <div className="space-y-4">
      <SplitBar
        label={outcomes
          .map(
            (outcome) => `${outcome.label}: ${formatCount(outcome.count)} of ${formatCount(total)}`,
          )
          .join(', ')}
        parts={outcomes.map((outcome) => ({
          label: outcome.label,
          value: outcome.count,
          color: OUTCOME_COLORS[outcome.key],
        }))}
      />
      {compact ? (
        <ul className="space-y-1.5">
          {outcomes.map((outcome) => (
            <li key={outcome.key} className="flex items-center justify-between gap-3 text-[13px]">
              <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
              <span className="text-ink">
                {formatCount(outcome.count)}{' '}
                <span className="text-ink-3">({formatShare(outcome.count, total)})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {outcomes.map((outcome) => (
            <li key={outcome.key} className="rounded-md border border-line bg-raised/40 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
                <span className="text-[13px] text-ink-3">{formatShare(outcome.count, total)}</span>
              </div>
              <p className="mt-1.5 text-2xl font-semibold text-ink">{formatCount(outcome.count)}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-3">{outcome.meaning}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One side of the market: how much energy was put up (offered, or asked
 * for), how much of it found a counterparty, and how much is still waiting -
 * with the offers or requests counted by where they stand.
 */
export function BookSide({
  title,
  help,
  book,
  color,
  totalLabel,
  openLabel,
}: {
  title: string;
  help: string;
  book: BookStats;
  color: string;
  totalLabel: string;
  openLabel: string;
}) {
  const matched = toChartNumber(book.matchedKwh) ?? 0;
  const open = toChartNumber(book.openKwh) ?? 0;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <Help term={title}>{help}</Help>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Amount label={totalLabel} value={book.totalKwh} />
        <Amount label="Matched" value={book.matchedKwh} />
        <Amount label={openLabel} value={book.openKwh} />
      </dl>
      <SplitBar
        label={`${groupDigits(book.matchedKwh)} kWh matched and ${groupDigits(book.openKwh)} kWh ${openLabel.toLowerCase()}`}
        parts={[
          { label: 'Matched', value: matched, color },
          { label: openLabel, value: open, color, faded: true },
        ]}
      />
      <p className="text-[13px] text-ink-3">
        {isZero(book.totalKwh)
          ? 'Nothing in this period.'
          : `${formatCount(book.total)} ${book.total === 1 ? 'entry' : 'entries'}: ${formatCount(book.matched)} fully matched, ${formatCount(book.partiallyMatched)} partly matched, ${formatCount(book.open)} not matched yet${book.cancelled > 0 ? `, ${formatCount(book.cancelled)} cancelled` : ''}.`}
      </p>
    </div>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold break-words text-ink">
        {groupDigits(value)} <span className="text-[13px] font-normal text-ink-3">kWh</span>
      </dd>
    </div>
  );
}
