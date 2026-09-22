import type { BillingSummary } from '../../types/api';
import { formatCount, groupDigits, isZero } from '../../utils/format';
import { CheckIcon, ErrorIcon, InfoIcon } from '../ui/icons';
import { cx } from '../ui/primitives';

/**
 * Whether the ledger balances for the period: every trade credits the seller
 * exactly what it debits the buyer, so credits minus debits is zero in a
 * healthy ledger. "Balanced" is only said when the figure the billing service
 * computed is exactly zero.
 */
export function BooksStatus({
  summary,
  size = 'large',
}: {
  summary: BillingSummary;
  size?: 'large' | 'compact';
}) {
  const { ledger, currency } = summary;
  const state = ledger.entries === 0 ? 'empty' : isZero(ledger.net) ? 'balanced' : 'unbalanced';
  const view = {
    empty: {
      icon: InfoIcon,
      color: 'text-ink-3',
      frame: 'border-line bg-surface',
      title: 'No ledger entries in this period',
      detail: 'Nothing was settled, so there is nothing to balance.',
    },
    balanced: {
      icon: CheckIcon,
      color: 'text-good',
      frame: 'border-good/40 bg-good/[0.06]',
      title: 'Books balanced',
      detail: `Credits to sellers equal debits from buyers: ${groupDigits(ledger.credited)} ${currency} each, over ${formatCount(ledger.entries)} ledger entries.`,
    },
    unbalanced: {
      icon: ErrorIcon,
      color: 'text-critical',
      frame: 'border-critical/50 bg-critical/[0.08]',
      title: 'Books not balanced',
      detail: `Credits and debits differ by ${groupDigits(ledger.net)} ${currency}. Every trade should credit and debit the same amount.`,
    },
  }[state];
  const Icon = view.icon;

  return (
    <div
      role="status"
      className={cx(
        'flex gap-3 rounded-lg border',
        view.frame,
        size === 'large' ? 'px-5 py-4' : 'px-4 py-3',
      )}
    >
      <Icon
        width={size === 'large' ? 26 : 18}
        height={size === 'large' ? 26 : 18}
        className={cx('shrink-0', view.color)}
      />
      <div className="min-w-0">
        <p className={cx('font-semibold text-ink', size === 'large' ? 'text-lg' : 'text-[15px]')}>
          {view.title}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">{view.detail}</p>
      </div>
    </div>
  );
}
