import type { BillingSection } from '../../hooks/use-dashboard-data';
import type { Resource } from '../../hooks/use-resource';
import { formatCount, groupDigits, isZero } from '../../utils/format';
import { ErrorState, Fact, LoadingBlock, Panel, StatusBadge } from '../ui/primitives';

/**
 * Settlement and the ledger. Billing records a trade and writes its credit and
 * debit in one transaction, so settled and billed are the same thing here.
 * The ledger's net is shown as the API computed it, and "balanced" is only
 * claimed when that figure is exactly zero.
 */
export function BillingPanel({ billing }: { billing: Resource<BillingSection> }) {
  return (
    <Panel
      title="Billing and settlement"
      subtitle="Settled trades and ledger entries in the window; balances as they stand now"
      refreshing={billing.refreshing}
    >
      {billing.status === 'loading' ? (
        <LoadingBlock label="Loading billing statistics" lines={6} />
      ) : billing.status === 'error' || !billing.data ? (
        <ErrorState
          title="Unable to load billing statistics."
          error={billing.error}
          retrying={billing.refreshing}
        />
      ) : (
        <BillingBody summary={billing.data.summary} />
      )}
    </Panel>
  );
}

function BillingBody({ summary }: { summary: BillingSection['summary'] }) {
  const { trades, ledger, balances, currency } = summary;
  const balanced = isZero(ledger.net);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-xs font-medium text-ink-3">Settled in the window</h3>
        {trades.trades === 0 ? (
          <p className="text-sm text-ink-2">No trades were settled in the selected period.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Settled volume" value={groupDigits(trades.volume)} unit={currency} />
            <Fact label="Settled trades" value={formatCount(trades.trades)} />
            <Fact label="Energy settled" value={groupDigits(trades.energyKwh)} unit="kWh" />
            <Fact
              label="Average price"
              value={groupDigits(trades.volumeWeightedPricePerKwh)}
              unit={`${currency}/kWh`}
              hint="Volume weighted"
            />
          </dl>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink-3">Ledger in the window</h3>
          {ledger.entries === 0 ? (
            <StatusBadge tone="neutral">No entries</StatusBadge>
          ) : balanced ? (
            <StatusBadge tone="good">Balanced: credits equal debits</StatusBadge>
          ) : (
            <StatusBadge tone="critical">
              Out of balance by {groupDigits(ledger.net)} {currency}
            </StatusBadge>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Credited to sellers" value={groupDigits(ledger.credited)} unit={currency} />
          <Fact label="Debited from buyers" value={groupDigits(ledger.debited)} unit={currency} />
          <Fact label="Net" value={groupDigits(ledger.net)} unit={currency} />
          <Fact
            label="Entries"
            value={formatCount(ledger.entries)}
            hint={`${formatCount(ledger.households)} households`}
          />
        </dl>
      </div>

      <div className="border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink-3">Balances now</h3>
          <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3">
            Current · not limited to the window
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact
            label="Owed to households"
            value={groupDigits(balances.totalCredit)}
            unit={currency}
            hint={`${formatCount(balances.inCredit)} in credit`}
          />
          <Fact
            label="Owed by households"
            value={groupDigits(balances.totalDebit)}
            unit={currency}
            hint={`${formatCount(balances.inDebit)} in debit`}
          />
          <Fact label="Settled to zero" value={formatCount(balances.settled)} hint="households" />
          <Fact label="Households with a balance" value={formatCount(balances.households)} />
        </dl>
      </div>
    </div>
  );
}
