import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { SETTLEMENT_CURRENCY } from '../../config/defaults';
import { useResource, type Resource } from '../../hooks/use-resource';
import { useServices } from '../../services/services-context';
import type { HouseholdQuery } from '../../services/solar-grid-api';
import type { HouseholdBilling, HouseholdEnergy, HouseholdTrading, Page } from '../../types/api';
import { formatCount, formatDateTime, groupDigits, sumDecimals } from '../../utils/format';
import { toStatsWindow, windowKey, type TimeWindow } from '../../utils/time-range';
import { Button, cx, EmptyState, ErrorState, LoadingBlock } from '../ui/primitives';

const PAGE_SIZE = 10;
/** The same alphabet the services accept for a household id. */
const HOUSEHOLD_ID = /^[A-Za-z0-9._:-]{1,64}$/;

type View = 'trading' | 'energy' | 'billing';

const VIEWS: ReadonlyArray<{ id: View; label: string; description: string }> = [
  {
    id: 'trading',
    label: 'Trading',
    description: 'Energy each household sold and bought, busiest by money first.',
  },
  {
    id: 'energy',
    label: 'Energy',
    description: 'What each household’s meter recorded, biggest producer first.',
  },
  {
    id: 'billing',
    label: 'Billing',
    description: 'What each household was credited and charged, most money first.',
  },
];

/**
 * Households as the three services know them, one tab each, searchable and
 * paged. There is no household registry: a household is here because it
 * reported, traded or was billed in the period. The id is shown, but quietly;
 * the numbers are what matter, and "Details" opens everything about one
 * household at once.
 */
export function HouseholdTables({
  timeWindow,
  refreshToken,
  onSelect,
}: {
  timeWindow: TimeWindow;
  refreshToken: number;
  onSelect: (householdId: string) => void;
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
  const props = { query, requestKey: key, refreshToken, onPage: setPage, onSelect };

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 pt-3">
        <div role="tablist" aria-label="Household lists" className="flex gap-1">
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
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
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
        <div className="pb-2">
          <HouseholdFilter
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <p className="px-4 pt-3 text-[13px] text-ink-3">{current.description}</p>
      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${view}-tab`}
        className="p-4 pt-3"
      >
        {view === 'trading' ? (
          <TradingTable key={view} {...props} />
        ) : view === 'energy' ? (
          <EnergyTable key={view} {...props} />
        ) : (
          <BillingTable key={view} {...props} />
        )}
      </div>
    </div>
  );
}

interface TableProps {
  query: HouseholdQuery;
  requestKey: string;
  refreshToken: number;
  onPage: (page: number) => void;
  onSelect: (householdId: string) => void;
}

const money = (label: string) => `${label} (${SETTLEMENT_CURRENCY})`;

function TradingTable({ query, requestKey, refreshToken, onPage, onSelect }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.tradeHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdTrading>
      resource={resource}
      label="Energy sold and bought per household"
      empty="No household completed a trade in this period."
      onPage={onPage}
      onSelect={onSelect}
      columns={[
        { header: 'Energy sold', align: 'right', cell: (row) => `${groupDigits(row.soldKwh)} kWh` },
        {
          header: 'Energy bought',
          align: 'right',
          cell: (row) => `${groupDigits(row.boughtKwh)} kWh`,
        },
        {
          header: 'Energy traded',
          align: 'right',
          cell: (row) => `${groupDigits(sumDecimals(row.soldKwh, row.boughtKwh))} kWh`,
        },
        {
          header: 'Trades',
          align: 'right',
          cell: (row) => formatCount(row.tradesAsSeller + row.tradesAsBuyer),
        },
        { header: money('Received'), align: 'right', cell: (row) => groupDigits(row.sellVolume) },
        { header: money('Paid'), align: 'right', cell: (row) => groupDigits(row.buyVolume) },
        { header: 'Last trade', cell: (row) => formatDateTime(row.lastTradeAt) },
      ]}
    />
  );
}

function EnergyTable({ query, requestKey, refreshToken, onPage, onSelect }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.energyHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdEnergy>
      resource={resource}
      label="Energy recorded per household"
      empty="No household reported a reading in this period."
      onPage={onPage}
      onSelect={onSelect}
      columns={[
        {
          header: 'Produced',
          align: 'right',
          cell: (row) => `${groupDigits(row.productionKwh)} kWh`,
        },
        { header: 'Used', align: 'right', cell: (row) => `${groupDigits(row.consumptionKwh)} kWh` },
        { header: 'Net', align: 'right', cell: (row) => `${groupDigits(row.netKwh)} kWh` },
        { header: 'Readings', align: 'right', cell: (row) => formatCount(row.readings) },
        { header: 'Last reading', cell: (row) => formatDateTime(row.lastReadingAt) },
      ]}
    />
  );
}

function BillingTable({ query, requestKey, refreshToken, onPage, onSelect }: TableProps) {
  const { api } = useServices();
  const resource = useResource(
    requestKey,
    refreshToken,
    async (signal) => (await api.billingHouseholds(query, signal)).data,
  );
  return (
    <HouseholdTable<HouseholdBilling>
      resource={resource}
      label="Money credited and charged per household"
      empty="No household has ledger entries in this period."
      onPage={onPage}
      onSelect={onSelect}
      columns={[
        { header: money('Credited'), align: 'right', cell: (row) => groupDigits(row.credited) },
        { header: money('Charged'), align: 'right', cell: (row) => groupDigits(row.debited) },
        { header: money('Net'), align: 'right', cell: (row) => groupDigits(row.net) },
        { header: 'Ledger entries', align: 'right', cell: (row) => formatCount(row.entries) },
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
  onSelect,
}: {
  resource: Resource<Page<T>>;
  label: string;
  empty: string;
  columns: Column<T>[];
  onPage: (page: number) => void;
  onSelect: (householdId: string) => void;
}) {
  if (resource.status === 'loading') return <LoadingBlock label="Loading households" lines={5} />;
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
      <div className="relative overflow-x-auto">
        <table className="figures w-full min-w-[46rem] border-collapse text-sm whitespace-nowrap">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="text-[13px] text-ink-3">
              <th scope="col" className="pb-2 pr-3 text-left font-medium">
                Household
              </th>
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
              <th scope="col" className="pb-2 text-right font-medium">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.householdId} className="border-t border-line hover:bg-raised/40">
                <th
                  scope="row"
                  className="max-w-[14rem] truncate py-2.5 pr-3 text-left font-mono text-xs font-normal text-ink-3"
                  title={row.householdId}
                >
                  {row.householdId}
                </th>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cx(
                      'py-2.5 pr-3 text-ink',
                      column.align === 'right' ? 'text-right' : 'text-left text-ink-2',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                <td className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    onClick={() => onSelect(row.householdId)}
                    aria-label={`Details for ${row.householdId}`}
                  >
                    Details
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav
        aria-label="Household pages"
        className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3"
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

/** Narrow the list to one household; checked against the id alphabet before it is sent. */
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
        placeholder="Find a household id"
        maxLength={64}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={problem !== null}
        aria-describedby={problem ? problemId : undefined}
        className="h-8 w-48 rounded-md border border-line bg-canvas px-2 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-ink-3"
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
        <p id={problemId} role="alert" className="w-full text-[13px] text-serious">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
