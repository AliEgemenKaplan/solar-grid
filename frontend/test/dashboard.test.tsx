import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsWindow } from '../src/services/solar-grid-api';
import {
  apiError,
  energyTrend,
  fakeApi,
  ok,
  priceTrend,
  readiness,
  tradeSummary,
  tradeTrend,
} from './fixtures';
import { renderApp } from './render';

afterEach(() => {
  vi.useRealTimers();
});

async function dashboard(options: Parameters<typeof renderApp>[0] = {}) {
  const rendered = renderApp({ signedIn: true, ...options });
  await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });
  return rendered;
}

const keyFigures = () => screen.getByRole('region', { name: 'Key figures' });
const panel = (name: string) => screen.getByRole('region', { name });

describe('key figures', () => {
  it('shows the six figures exactly as the services reported them', async () => {
    await dashboard();
    const figures = keyFigures();

    await within(figures).findByText('1,234.500');
    expect(within(figures).getByText('987.250')).toBeInTheDocument();
    expect(within(figures).getByText('247.250')).toBeInTheDocument();
    expect(within(figures).getByText('15.000')).toBeInTheDocument();
    expect(within(figures).getByText('65.00')).toBeInTheDocument();
    // The volume weighted price, not an average worked out here.
    expect(within(figures).getByText('4.3333')).toBeInTheDocument();
    expect(within(figures).getByText(/Net export/)).toBeInTheDocument();
    expect(within(figures).getByText('2 settled trades')).toBeInTheDocument();
  });

  it('shows placeholders while the first answers are on their way', async () => {
    const never = () => new Promise(() => undefined);
    await dashboard({ api: fakeApi({ energySummary: vi.fn(never), tradeSummary: vi.fn(never) }) });

    expect(within(keyFigures()).getByText('Loading production')).toBeInTheDocument();
    expect(within(keyFigures()).getByText('Loading traded energy')).toBeInTheDocument();
  });

  it('keeps the rest of the dashboard when one service fails', async () => {
    const api = fakeApi({
      energySummary: vi.fn(async () =>
        Promise.reject(apiError('network', 'Smart meter could not be reached.')),
      ),
    });
    await dashboard({ api });

    await within(keyFigures()).findByText('15.000');
    expect(within(keyFigures()).getAllByText('Unavailable')).toHaveLength(3);
    expect(
      await within(panel('Energy')).findByText('Unable to load energy statistics.'),
    ).toBeInTheDocument();
    expect(
      within(panel('Energy')).getByText('Smart meter could not be reached.'),
    ).toBeInTheDocument();
    // Enough to find the request in the service's logs, and nothing more.
    expect(within(panel('Energy')).getByText('dashboard-failed-request')).toBeInTheDocument();
  });
});

describe('charts', () => {
  it('draws the energy series and offers every value as a table', async () => {
    const user = userEvent.setup();
    await dashboard();
    const energy = panel('Energy');

    expect(
      await within(energy).findByRole('list', { name: 'Energy over time legend' }),
    ).toHaveTextContent('ProductionConsumptionNet');
    // Production and consumption as areas, net as a line, on one axis.
    expect(energy.querySelectorAll('.recharts-area')).toHaveLength(2);
    expect(energy.querySelectorAll('.recharts-line')).toHaveLength(1);
    expect(energy.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    await user.click(within(energy).getByRole('button', { name: /Show table/ }));

    const rows = within(within(energy).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(energyTrend.buckets.length);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['19 Sep 09:00 UTC, 1 hour', '2', '13.000', '7.000', '6.000'],
      // The quiet hour is a row of zeros, as the API reported it.
      ['19 Sep 10:00 UTC, 1 hour', '0', '0.000', '0.000', '0.000'],
      ['19 Sep 11:00 UTC, 1 hour', '1', '1.000', '5.000', '-4.000'],
    ]);
  });

  it('draws traded energy, volume and price as three charts, not one with two scales', async () => {
    const user = userEvent.setup();
    await dashboard();
    const market = panel('Market');

    await waitFor(() => expect(market.querySelectorAll('svg.recharts-surface')).toHaveLength(3));
    const titles = [...market.querySelectorAll('svg.recharts-surface > title')].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(['Traded energy', 'Trade volume', 'Average price']);
    // Each has one y-axis of its own.
    expect(market.querySelectorAll('.recharts-yAxis')).toHaveLength(3);

    await user.click(within(market).getByRole('button', { name: /Show table/ }));
    const rows = within(within(market).getByRole('table')).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual(
      tradeTrend.buckets.map((bucket, index) => [
        ['19 Sep 09:00 UTC, 1 hour', '19 Sep 10:00 UTC, 1 hour', '19 Sep 11:00 UTC, 1 hour'][index],
        String(bucket.trades),
        String(bucket.completed),
        bucket.energyKwh,
        bucket.volume,
        // An hour with no trades has no price; it is not a price of zero.
        bucket.averagePricePerKwh ?? '—',
      ]),
    );
  });

  it('shows the price against its band, with the current price', async () => {
    const user = userEvent.setup();
    await dashboard();
    const price = panel('Price');

    await within(price).findByText('Current price');
    expect(within(price).getByText('2.5000–7.0000')).toBeInTheDocument();
    await user.click(within(price).getByRole('button', { name: /Show table/ }));
    const rows = within(within(price).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(priceTrend.buckets.length);
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['19 Sep 10:00 UTC, 1 hour', '0', '—', '—', '—']);
  });

  it('says so when a window has no trading, instead of drawing an empty chart', async () => {
    const quiet = {
      ...tradeTrend,
      buckets: tradeTrend.buckets.map((bucket) => ({
        ...bucket,
        trades: 0,
        completed: 0,
        energyKwh: '0.000',
        volume: '0.00',
        averagePricePerKwh: null,
      })),
    };
    await dashboard({ api: fakeApi({ tradeTrend: vi.fn(async () => ok(quiet)) }) });

    expect(
      await within(panel('Market')).findByText('No trading activity in this window.'),
    ).toBeInTheDocument();
  });
});

describe('the time window', () => {
  const lastWindow = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as StatsWindow;
  const hours = (window: StatsWindow) =>
    (Date.parse(window.to) - Date.parse(window.from)) / 3_600_000;

  it('starts with the last 24 hours in hourly buckets', async () => {
    const { api } = await dashboard();
    await waitFor(() => expect(api.energySummary).toHaveBeenCalled());

    expect(hours(lastWindow(api.energySummary as never))).toBe(24);
    expect((api.energyTrend as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe('hour');
    expect(screen.getByRole('radio', { name: 'Last 24 hours' })).toBeChecked();
  });

  it('asks every service for the new window when a preset is chosen', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();
    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));

    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(2));
    for (const call of [
      api.energySummary,
      api.tradeSummary,
      api.priceSummary,
      api.billingSummary,
    ]) {
      expect(hours(lastWindow(call as never))).toBe(30 * 24);
    }
    expect((api.tradeTrend as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBe('day');
  });

  it('applies a custom range, both days included', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();

    await user.click(screen.getByRole('radio', { name: 'Custom dates' }));
    const from = screen.getByLabelText('From (UTC)');
    const to = screen.getByLabelText('To, inclusive (UTC)');
    await user.clear(from);
    await user.type(from, '2026-09-01');
    await user.clear(to);
    await user.type(to, '2026-09-03');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastWindow(api.billingSummary as never)).toEqual({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-04T00:00:00.000Z',
      }),
    );
  });

  it('explains a range it will not send', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();
    await waitFor(() => expect(api.billingSummary).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('radio', { name: 'Custom dates' }));
    const from = screen.getByLabelText('From (UTC)');
    const to = screen.getByLabelText('To, inclusive (UTC)');
    await user.clear(from);
    await user.type(from, '2026-09-10');
    await user.clear(to);
    await user.type(to, '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date must be on or before the end date.',
    );
    expect(api.billingSummary).toHaveBeenCalledTimes(1);
  });
});

describe('refreshing', () => {
  it('fetches everything again on request, keeping the figures on screen meanwhile', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();
    await within(keyFigures()).findByText('15.000');

    await user.click(screen.getByRole('button', { name: 'Refresh all statistics now' }));

    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(2));
    expect(api.readiness).toHaveBeenCalledTimes(8);
    expect(within(keyFigures()).getByText('15.000')).toBeInTheDocument();
    await screen.findByText(/^Updated \d\d:\d\d:\d\d UTC$/);
  });

  it('refreshes on a timer, and never starts a refresh while one is running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: () => void = () => undefined;
    const slow = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(tradeSummary));
        }),
    );
    renderApp({ signedIn: true, autoRefreshMs: 1_000, api: fakeApi({ tradeSummary: slow }) });
    await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));

    // The first load is still running, so the timer does not start another.
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(slow).toHaveBeenCalledTimes(1);

    await act(async () => release());
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(2));
  });

  it('stops refreshing on a timer when switched off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = renderApp({ signedIn: true, autoRefreshMs: 1_000 });
    await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });
    const autoRefresh = screen.getByRole('switch', { name: /Auto refresh/ });
    expect(autoRefresh).toHaveAttribute('aria-checked', 'true');

    await act(async () => autoRefresh.click());
    expect(autoRefresh).toHaveAttribute('aria-checked', 'false');
    const calls = (api.tradeSummary as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(api.tradeSummary).toHaveBeenCalledTimes(calls);
  });
});

describe('market, billing and health panels', () => {
  it('shows matched and unmatched energy for offers and requests', async () => {
    await dashboard();
    const market = panel('Market activity');

    await within(market).findByText('Supply offered');
    expect(
      within(market).getByRole('img', {
        name: '17.000 kWh matched and 10.000 kWh still open, of 27.000 kWh',
      }),
    ).toBeInTheDocument();
    expect(within(market).getByText('Awaiting billing')).toBeInTheDocument();
    expect(within(market).getByText('Refused by billing')).toBeInTheDocument();
  });

  it('says a ledger balances only when its net is exactly zero', async () => {
    await dashboard();
    const billing = panel('Billing and settlement');

    expect(await within(billing).findByText('Balanced: credits equal debits')).toBeInTheDocument();
    expect(within(billing).getByText('Current · not limited to the window')).toBeInTheDocument();
  });

  it('flags a ledger that does not balance, with the amount', async () => {
    const { billingSummary } = await import('./fixtures');
    const unbalanced = { ...billingSummary, ledger: { ...billingSummary.ledger, net: '-0.01' } };
    await dashboard({ api: fakeApi({ billingSummary: vi.fn(async () => ok(unbalanced)) }) });

    expect(
      await within(panel('Billing and settlement')).findByText('Out of balance by -0.01 TRY'),
    ).toBeInTheDocument();
  });

  it('reports each service by status in words, never colour alone', async () => {
    const api = fakeApi({
      readiness: vi.fn(async (service: string) =>
        service === 'billing'
          ? { report: readiness(service, 'not_ready'), httpStatus: 503, latencyMs: 9, error: null }
          : service === 'pricing'
            ? { report: null, httpStatus: null, latencyMs: null, error: apiError('network') }
            : { report: readiness(service), httpStatus: 200, latencyMs: 7, error: null },
      ),
    });
    await dashboard({ api });
    const health = panel('Service health');

    const row = async (name: string) =>
      (await within(health).findByRole('rowheader', { name })).closest('tr')!;
    expect(await row('Smart meter')).toHaveTextContent('Ready');
    expect(await row('Billing ledger')).toHaveTextContent('Not ready');
    expect(await row('Billing ledger')).toHaveTextContent('Database down');
    expect(await row('Pricing engine')).toHaveTextContent('Unreachable');
    expect(within(health).getByText('2 of 4 services ready')).toBeInTheDocument();
  });
});

describe('household activity', () => {
  it('lists households as the API reports them, one page at a time', async () => {
    const user = userEvent.setup();
    const { tradingHouseholds, page } = await import('./fixtures');
    const tradeHouseholds = vi.fn(async (query: { page: number }) =>
      ok(page(tradingHouseholds, 25, query.page, 10)),
    );
    await dashboard({ api: fakeApi({ tradeHouseholds }) });
    const households = panel('Household activity');

    expect(await within(households).findByRole('rowheader', { name: 'HH-A' })).toBeInTheDocument();
    expect(within(households).getByText('1–10 of 25 households')).toBeInTheDocument();

    await user.click(within(households).getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(tradeHouseholds.mock.calls.at(-1)![0]).toMatchObject({ page: 2, limit: 10 }),
    );
    expect(within(households).getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('switches between trading, energy and billing, by keyboard too', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();
    const households = panel('Household activity');
    const trading = await within(households).findByRole('tab', { name: 'Trading' });
    expect(trading).toHaveAttribute('aria-selected', 'true');

    trading.focus();
    await user.keyboard('{ArrowRight}');

    expect(within(households).getByRole('tab', { name: 'Energy' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await within(households).findByRole('columnheader', { name: 'Production' }),
    ).toBeInTheDocument();
    expect(api.energyHouseholds).toHaveBeenCalled();
  });

  it('filters to one household, and refuses an id the API would reject', async () => {
    const user = userEvent.setup();
    const { api } = await dashboard();
    const households = panel('Household activity');
    await within(households).findByRole('rowheader', { name: 'HH-A' });

    await user.type(within(households).getByLabelText('Household id'), 'HH A;--');
    await user.click(within(households).getByRole('button', { name: 'Find' }));
    expect(within(households).getByRole('alert')).toHaveTextContent('Use letters, digits');

    await user.clear(within(households).getByLabelText('Household id'));
    await user.type(within(households).getByLabelText('Household id'), 'HH-B');
    await user.click(within(households).getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect((api.tradeHouseholds as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject(
        {
          householdId: 'HH-B',
          page: 1,
        },
      ),
    );
  });

  it('shows a clear empty state when no household traded', async () => {
    const { page } = await import('./fixtures');
    await dashboard({ api: fakeApi({ tradeHouseholds: vi.fn(async () => ok(page([], 0))) }) });

    expect(
      await within(panel('Household activity')).findByText(
        'No household completed a trade in the selected period.',
      ),
    ).toBeInTheDocument();
  });
});
