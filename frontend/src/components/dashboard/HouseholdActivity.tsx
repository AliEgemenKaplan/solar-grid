import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useResource, type Resource } from '../../hooks/use-resource';
import { useServices } from '../../services/services-context';
import type { HouseholdQuery } from '../../services/solar-grid-api';
import type { HouseholdBilling, HouseholdEnergy, HouseholdTrading, Page } from '../../types/api';
import { SETTLEMENT_CURRENCY } from '../../config/defaults';
import { formatCount, formatDateTime, groupDigits } from '../../utils/format';
import { toStatsWindow, windowKey, type TimeWindow } from '../../utils/time-range';
import { Button, cx, EmptyState, ErrorState, LoadingBlock, Panel } from '../ui/primitives';

const PAGE_SIZE = 10;
/** The same alphabet the services accept for a household id. */
const HOUSEHOLD_ID = /^[A-Za-z0-9._:-]{1,64}$/;

type View = 'trading' | 'energy' | 'billing';

const VIEWS: ReadonlyArray<{ id: View; label: string; description: string }> = [
  {
    id: 'trading',
    label: 'Trading',
    description: 'Settled trades per household, busiest by money first',
  },
  {
    id: 'energy',
    label: 'Energy',
    description: 'Meter readings per household, biggest producer first',
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'Ledger entries per household, most money moved first',
  },
];

/**
 * Per-household activity from the three services that know about households.
 * There is no household registry: a household appears because it reported,
 * traded or was billed in the window, exactly as the API lists it.
 */
export function HouseholdActivity({
  timeWindow,
  refreshToken,
}: {
  timeWindow: TimeWindow;
  refreshToken: number;
}) {
  const [view, setView] = useState<View>('trading');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const tabsId = useId();
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({
    trading: null,
    energy: null,
    billing: null,
  });

  const select = (next: View) => {
    setView(next);
    setPage(1);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset === 0) return;
    event.preventDefault();
    const next = VIEWS[(index + offset + VIEWS.length) % VIEWS.length]!.id;
    select(next);
    tabRefs.current[next]?.focus();
  };

  const current = VIEWS.find((candidate) => candidate.id === view)!;
  const query: HouseholdQuery = {
    ...toStatsWindow(timeWindow),
    page,
    limit: PAGE_SIZE,
    householdId: filter,
  };
  const key = `${view}|${windowKey(timeWindow)}|${page}|${filter ?? ''}`;

  return (
    <Panel
      title="Household activity"
      subtitle={current.description}
      actions={
        <HouseholdFilter
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
        />
      }
    >
      <div
        role="tablist"
        aria-label="Household statistics"
        className="mb-3 flex gap-1 border-b border-line"
      >
        {VIEWS.map((candidate, index) => {
          const selected = candidate.id === view;
          return (
            <button
              key={candidate.id}
              ref={(element) => {
                tabRefs.current[candidate.id] = element;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${candidate.id}-tab`}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(candidate.id)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium',
                selected
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              {candidate.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${view}-tab`}>
        {view === 'trading' ? (
          <TradingTable
            key={view}
            query={query}
            requestKey={key}
            refreshToken={refreshToken}
            onPage={setPage}
          />
        ) : view === 'energy' ? (
          <EnergyTable
            key={view}
            query={query}
            requestKey={key}
            refreshToken={refreshToken}
            onPage={setPage}
          />
        ) : (
          <BillingTable
            key={view}
            query={query}
            requestKey={key}
            refreshToken={refreshToken}
            onPage={setPage}
          />
        )}
      </div>
    </Panel>
  );
}

interface TableProps {
  query: HouseholdQuery;
  requestKey: string;
  refreshToken: number;
  onPage: (page: number) => void;
}

function TradingTable({ query, requestKey, refreshToken, onPage }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.tradeHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdTrading>
      resource={resource}
      label="Settled trading per household"
      empty="No household completed a trade in the selected period."
      onPage={onPage}
      columns={[
        { header: 'Household', cell: (row) => <HouseholdId id={row.householdId} /> },
        { header: 'Sold', align: 'right', cell: (row) => `${groupDigits(row.soldKwh)} kWh` },
        { header: 'Bought', align: 'right', cell: (row) => `${groupDigits(row.boughtKwh)} kWh` },
        {
          header: 'Trades',
          align: 'right',
          cell: (row) =>
            `${formatCount(row.tradesAsSeller)} sold · ${formatCount(row.tradesAsBuyer)} bought`,
        },
        {
          header: `Sales (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.sellVolume),
        },
        {
          header: `Purchases (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.buyVolume),
        },
        {
          header: `Net (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.netVolume),
        },
        { header: 'Last trade', cell: (row) => formatDateTime(row.lastTradeAt) },
      ]}
    />
  );
}

function EnergyTable({ query, requestKey, refreshToken, onPage }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.energyHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdEnergy>
      resource={resource}
      label="Meter readings per household"
      empty="No household reported a reading in the selected period."
      onPage={onPage}
      columns={[
        { header: 'Household', cell: (row) => <HouseholdId id={row.householdId} /> },
        { header: 'Readings', align: 'right', cell: (row) => formatCount(row.readings) },
        {
          header: 'Production',
          align: 'right',
          cell: (row) => `${groupDigits(row.productionKwh)} kWh`,
        },
        {
          header: 'Consumption',
          align: 'right',
          cell: (row) => `${groupDigits(row.consumptionKwh)} kWh`,
        },
        { header: 'Net', align: 'right', cell: (row) => `${groupDigits(row.netKwh)} kWh` },
        { header: 'Last reading', cell: (row) => formatDateTime(row.lastReadingAt) },
      ]}
    />
  );
}

function BillingTable({ query, requestKey, refreshToken, onPage }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.billingHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdBilling>
      resource={resource}
      label="Ledger entries per household"
      empty="No household has ledger entries in the selected period."
      onPage={onPage}
      columns={[
        { header: 'Household', cell: (row) => <HouseholdId id={row.householdId} /> },
        { header: 'Entries', align: 'right', cell: (row) => formatCount(row.entries) },
        {
          header: `Credited (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.credited),
        },
        {
          header: `Debited (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.debited),
        },
        {
          header: `Net (${SETTLEMENT_CURRENCY})`,
          align: 'right',
          cell: (row) => groupDigits(row.net),
        },
        { header: 'Last entry', cell: (row) => formatDateTime(row.lastEntryAt) },
      ]}
    />
  );
}

interface Column<T> {
  header: string;
  align?: 'left' | 'right';
  cell: (row: T) => ReactNode;
}

function HouseholdTable<T extends { householdId: string }>({
  resource,
  label,
  empty,
  columns,
  onPage,
}: {
  resource: Resource<Page<T>>;
  label: string;
  empty: string;
  columns: Column<T>[];
  onPage: (page: number) => void;
}) {
  if (resource.status === 'loading')
    return <LoadingBlock label="Loading household statistics" lines={5} />;
  if (resource.status === 'error' || !resource.data) {
    return (
      <ErrorState
        title="Unable to load household statistics."
        error={resource.error}
        retrying={resource.refreshing}
      />
    );
  }

  const { items, page, limit, total } = resource.data;
  if (total === 0) return <EmptyState title={empty} />;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div
      className={cx('transition-opacity', resource.refreshing && 'opacity-60')}
      aria-busy={resource.refreshing || undefined}
    >
      <div className="overflow-x-auto">
        <table className="figures w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="text-xs text-ink-3">
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={cx(
                    'pb-2 pr-3 font-medium',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.householdId} className="border-t border-line">
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th key={column.header} scope="row" className="py-2 pr-3 text-left font-normal">
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={column.header}
                      className={cx(
                        'py-2 pr-3 text-ink-2',
                        column.align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        aria-label="Household pages"
        className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3"
      >
        <p aria-live="polite">
          {formatCount((page - 1) * limit + 1)}–{formatCount(Math.min(page * limit, total))} of{' '}
          {formatCount(total)} households
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {formatCount(page)} of {formatCount(pages)}
          </span>
          <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      </nav>
    </div>
  );
}

function HouseholdId({ id }: { id: string }) {
  return <span className="font-mono text-xs text-ink">{id}</span>;
}

/** Narrow the table to one household; checked against the id alphabet before it is sent. */
function HouseholdFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const problemId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === '') {
      setProblem(null);
      onChange(undefined);
      return;
    }
    if (!HOUSEHOLD_ID.test(trimmed)) {
      setProblem('Use letters, digits, ".", "_", ":" or "-".');
      return;
    }
    setProblem(null);
    onChange(trimmed);
  };

  return (
    <form role="search" onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={inputId} className="sr-only">
        Household id
      </label>
      <input
        id={inputId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Household id"
        maxLength={64}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={problem !== null}
        aria-describedby={problem ? problemId : undefined}
        className="h-8 w-40 rounded-md border border-line bg-canvas px-2 font-mono text-xs text-ink placeholder:font-sans placeholder:text-ink-3"
      />
      <Button type="submit">Find</Button>
      {value ? (
        <Button
          variant="ghost"
          onClick={() => {
            setDraft('');
            setProblem(null);
            onChange(undefined);
          }}
        >
          Clear
        </Button>
      ) : null}
      {problem ? (
        <p id={problemId} role="alert" className="w-full text-xs text-serious">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
