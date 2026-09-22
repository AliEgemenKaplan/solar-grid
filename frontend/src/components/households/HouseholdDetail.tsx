import type { ReactNode } from 'react';
import { SETTLEMENT_CURRENCY } from '../../config/defaults';
import { useResource } from '../../hooks/use-resource';
import { endsTheSession, isApiError, type ApiError } from '../../services/api-error';
import { useServices } from '../../services/services-context';
import type {
  HouseholdBalance,
  HouseholdBilling,
  HouseholdEnergy,
  HouseholdStatus,
  HouseholdTrading,
} from '../../types/api';
import {
  formatCount,
  formatDateTime,
  groupDigits,
  isNegative,
  isZero,
  sumDecimals,
} from '../../utils/format';
import { toStatsWindow, windowKey, type TimeWindow } from '../../utils/time-range';
import { Drawer, Figure } from '../ui/layout';
import { LoadingBlock, StatusBadge } from '../ui/primitives';

type Part<T> = { value: T; error: null } | { value: null; error: ApiError };

interface Detail {
  status: Part<HouseholdStatus | null>;
  balance: Part<HouseholdBalance>;
  energy: Part<HouseholdEnergy | null>;
  trading: Part<HouseholdTrading | null>;
  billing: Part<HouseholdBilling | null>;
}

/**
 * Everything the services can say about one household, gathered from the
 * endpoints that already exist: its latest reading and its balance as they
 * stand now, and its energy, trading and billing for the period. A service
 * that cannot answer leaves a gap in its own part, not the whole panel.
 */
export function HouseholdDetail({
  householdId,
  timeWindow,
  period,
  refreshToken,
  onClose,
}: {
  householdId: string;
  timeWindow: TimeWindow;
  period: string;
  refreshToken: number;
  onClose: () => void;
}) {
  const { api } = useServices();
  const detail = useResource(
    `${householdId}|${windowKey(timeWindow)}`,
    refreshToken,
    async (signal): Promise<Detail> => {
      const query = { ...toStatsWindow(timeWindow), page: 1, limit: 1, householdId };
      const part = async <T,>(load: () => Promise<T>): Promise<Part<T>> => {
        try {
          return { value: await load(), error: null };
        } catch (error) {
          if (!isApiError(error) || endsTheSession(error) || error.kind === 'aborted') throw error;
          return { value: null, error };
        }
      };
      const [status, balance, energy, trading, billing] = await Promise.all([
        part(() => api.householdStatus(householdId, signal)),
        part(() => api.householdBalance(householdId, signal)),
        part(async () => (await api.energyHouseholds(query, signal)).data.items[0] ?? null),
        part(async () => (await api.tradeHouseholds(query, signal)).data.items[0] ?? null),
        part(async () => (await api.billingHouseholds(query, signal)).data.items[0] ?? null),
      ]);
      return { status, balance, energy, trading, billing };
    },
  );

  return (
    <Drawer title={householdId} subtitle="Household" onClose={onClose}>
      {!detail.data ? (
        detail.status === 'error' ? (
          <p className="text-sm text-ink-2">{detail.error?.message}</p>
        ) : (
          <LoadingBlock label="Loading the household" lines={6} />
        )
      ) : (
        <>
          <Group title="Right now" note="As things stand, whatever period is selected.">
            <PartView
              part={detail.data.status}
              missing="This household has never sent a meter reading."
            >
              {(status) => (
                <div className="space-y-1">
                  <StatusBadge tone="neutral">
                    {status.currentStatus === 'SURPLUS'
                      ? `Has ${groupDigits(status.currentSurplusKwh)} kWh spare`
                      : status.currentStatus === 'DEMAND'
                        ? `Needs ${groupDigits(status.currentDemandKwh)} kWh`
                        : 'Using exactly what it produces'}
                  </StatusBadge>
                  <p className="text-[13px] text-ink-3">
                    From its latest reading, {formatDateTime(status.lastReadingAt)}.
                  </p>
                </div>
              )}
            </PartView>
            <PartView part={detail.data.balance}>
              {(balance) => (
                <dl>
                  <Figure
                    label="Balance"
                    value={groupDigits(balance.balance)}
                    unit={balance.currency}
                    note={
                      balance.updatedAt === null
                        ? 'Has never traded.'
                        : isZero(balance.balance)
                          ? 'Even: has earned as much selling as it has spent buying.'
                          : isNegative(balance.balance)
                            ? 'In debit: has spent more buying energy than it has earned selling.'
                            : 'In credit: has earned more selling energy than it has spent buying.'
                    }
                  />
                </dl>
              )}
            </PartView>
          </Group>

          <Group title="In the selected period" note={period}>
            <PartView
              title="Energy"
              part={detail.data.energy}
              missing="No meter readings in this period."
            >
              {(energy) => (
                <dl className="grid grid-cols-2 gap-4">
                  <Figure label="Produced" value={groupDigits(energy.productionKwh)} unit="kWh" />
                  <Figure label="Used" value={groupDigits(energy.consumptionKwh)} unit="kWh" />
                  <Figure label="Net" value={groupDigits(energy.netKwh)} unit="kWh" />
                  <Figure label="Readings" value={formatCount(energy.readings)} />
                </dl>
              )}
            </PartView>
            <PartView
              title="Trading"
              part={detail.data.trading}
              missing="No settled trades in this period."
            >
              {(trading) => (
                <dl className="grid grid-cols-2 gap-4">
                  <Figure
                    label="Energy sold"
                    value={groupDigits(trading.soldKwh)}
                    unit="kWh"
                    note={`${formatCount(trading.tradesAsSeller)} ${trading.tradesAsSeller === 1 ? 'trade' : 'trades'} as seller`}
                  />
                  <Figure
                    label="Energy bought"
                    value={groupDigits(trading.boughtKwh)}
                    unit="kWh"
                    note={`${formatCount(trading.tradesAsBuyer)} ${trading.tradesAsBuyer === 1 ? 'trade' : 'trades'} as buyer`}
                  />
                  <Figure
                    label="Energy traded"
                    value={groupDigits(sumDecimals(trading.soldKwh, trading.boughtKwh))}
                    unit="kWh"
                  />
                  <Figure
                    label="Received minus paid"
                    value={groupDigits(trading.netVolume)}
                    unit={SETTLEMENT_CURRENCY}
                    note={`Last trade ${formatDateTime(trading.lastTradeAt)}`}
                  />
                </dl>
              )}
            </PartView>
            <PartView
              title="Billing"
              part={detail.data.billing}
              missing="No ledger entries in this period."
            >
              {(billing) => (
                <dl className="grid grid-cols-2 gap-4">
                  <Figure
                    label="Credited"
                    value={groupDigits(billing.credited)}
                    unit={SETTLEMENT_CURRENCY}
                  />
                  <Figure
                    label="Charged"
                    value={groupDigits(billing.debited)}
                    unit={SETTLEMENT_CURRENCY}
                  />
                  <Figure label="Ledger entries" value={formatCount(billing.entries)} />
                </dl>
              )}
            </PartView>
          </Group>
        </>
      )}
    </Drawer>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="text-[13px] text-ink-3">{note}</p>
      </div>
      <div className="space-y-4 rounded-md border border-line bg-surface p-4">{children}</div>
    </section>
  );
}

function PartView<T>({
  title,
  part,
  missing,
  children,
}: {
  /** Names the part when a group holds several. */
  title?: string;
  part: Part<T | null>;
  missing?: string;
  children: (value: T) => ReactNode;
}) {
  const body = part.error ? (
    <p className="text-[13px] text-ink-3">Not available: {part.error.message}</p>
  ) : part.value === null ? (
    <p className="text-[13px] text-ink-3">{missing}</p>
  ) : (
    children(part.value)
  );
  if (!title) return <>{body}</>;
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h4>
      {body}
    </div>
  );
}
