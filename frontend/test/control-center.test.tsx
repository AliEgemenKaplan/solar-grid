import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsWindow } from '../src/services/solar-grid-api';
import {
  apiError,
  billingSummary,
  diagnosticsSnapshots,
  fakeApi,
  ok,
  readiness,
  tradeSummary,
} from './fixtures';
import { renderApp, renderPage } from './render';

afterEach(() => {
  vi.useRealTimers();
});

const overview = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderPage('overview', 'Overview', options);
const region = (name: string) => screen.getByRole('region', { name });
const navigation = () => screen.getByRole('navigation', { name: 'Pages' });

/** Nothing waiting, nothing refused, nothing queued: a grid with nothing to report. */
function quietApi() {
  const smartMeter = diagnosticsSnapshots.smartMeter!;
  return fakeApi({
    tradeSummary: vi.fn(async () =>
      ok({ ...tradeSummary, trades: { total: 2, completed: 2, pendingBilling: 0, failed: 0 } }),
    ),
    diagnostics: vi.fn(async (service: string) =>
      ok(
        service === 'smartMeter'
          ? {
              ...smartMeter,
              metrics: smartMeter.metrics.map((metric) =>
                metric.name === 'outbox_events_pending'
                  ? { ...metric, series: [{ labels: {}, value: 0 }] }
                  : metric,
              ),
            }
          : diagnosticsSnapshots[service]!,
      ),
    ),
  });
}

const readinessBy = (states: Record<string, 'ready' | 'not_ready' | 'unreachable'>) =>
  vi.fn(async (service: string) => {
    const state = states[service] ?? 'ready';
    if (state === 'unreachable') {
      return { report: null, httpStatus: null, latencyMs: null, error: apiError('network') };
    }
    return {
      report: readiness(service, state),
      httpStatus: state === 'ready' ? 200 : 503,
      latencyMs: 7,
      error: null,
    };
  });

describe('the shell', () => {
  it('opens on the overview, with every page one link away', async () => {
    await overview();

    const links = within(navigation()).getAllByRole('link');
    expect(links.map((link) => link.textContent?.replace(/,.*$/, ''))).toEqual([
      'Overview',
      'Energy',
      'Market',
      'Trading',
      'Billing',
      'Households',
      'System health',
    ]);
    expect(within(navigation()).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Is the grid healthy, and what is it doing?')).toBeInTheDocument();
  });

  it('moves between pages, and the address follows so links and Back work', async () => {
    const user = userEvent.setup();
    await overview();

    await user.click(within(navigation()).getByRole('link', { name: 'Market' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Market' })).toHaveFocus();
    expect(window.location.hash).toBe('#/market');
    expect(within(navigation()).getByRole('link', { name: 'Market' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('starts a new page at its top, wherever the last one was scrolled to', async () => {
    const user = userEvent.setup();
    await overview();
    document.documentElement.scrollTop = 900;

    await user.click(within(navigation()).getByRole('link', { name: /^Trading/ }));

    await screen.findByRole('heading', { level: 1, name: 'Trading' });
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it('opens the page named in the address', async () => {
    await renderPage('billing', 'Billing');
    expect(screen.getByText('What was settled, and do the books balance?')).toBeInTheDocument();
  });

  it('falls back to the overview for an address it does not know', async () => {
    await renderPage('not-a-page', 'Overview');
  });

  it('loads each service once, however many pages are visited', async () => {
    const user = userEvent.setup();
    const { api } = await overview();
    await waitFor(() => expect(api.billingSummary).toHaveBeenCalledTimes(1));

    for (const name of ['Energy', 'Market', 'Trading', 'Billing']) {
      await user.click(within(navigation()).getByRole('link', { name: new RegExp(`^${name}`) }));
      await screen.findByRole('heading', { level: 1, name });
    }

    expect(api.energySummary).toHaveBeenCalledTimes(1);
    expect(api.tradeSummary).toHaveBeenCalledTimes(1);
    expect(api.priceSummary).toHaveBeenCalledTimes(1);
    expect(api.billingSummary).toHaveBeenCalledTimes(1);
    expect(api.readiness).toHaveBeenCalledTimes(4);
    expect(api.diagnostics).toHaveBeenCalledTimes(4);
  });

  it('marks the pages that have something to look at', async () => {
    await overview();

    // One trade refused and one waiting for billing; two meter events waiting.
    expect(
      await within(navigation()).findByRole('link', { name: 'Trading, 2 items to look at' }),
    ).toBeInTheDocument();
    expect(
      within(navigation()).getByRole('link', { name: 'System health, 1 item to look at' }),
    ).toBeInTheDocument();
    expect(within(navigation()).getByRole('link', { name: 'Billing' })).toBeInTheDocument();
  });

  it('shows the state of the system on every page', async () => {
    await renderPage('market', 'Market');
    expect(
      await screen.findByRole('link', { name: 'All systems operational: see service details' }),
    ).toHaveAttribute('href', '#/system');
  });
});

describe('the overview', () => {
  it('puts the system status and what needs attention above the period', async () => {
    await overview();
    const order = [region('System status'), region('Issues'), region('Period')];
    for (let index = 1; index < order.length; index++) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('says first whether everything is working', async () => {
    await overview();
    const status = region('System status');

    expect(await within(status).findByText('All systems operational')).toBeInTheDocument();
    expect(within(status).getByText('4 of 4 services ready')).toBeInTheDocument();
    expect(within(status).getAllByText('Ready')).toHaveLength(4);
  });

  it('says plainly when nothing needs attention', async () => {
    await overview({ api: quietApi() });

    expect(await within(region('Issues')).findByText('No issues detected')).toBeInTheDocument();
  });

  it('lists what needs attention, most serious first, and where to look', async () => {
    const user = userEvent.setup();
    const unbalanced = { ...billingSummary, ledger: { ...billingSummary.ledger, net: '-0.01' } };
    await overview({ api: fakeApi({ billingSummary: vi.fn(async () => ok(unbalanced)) }) });
    const issues = region('Issues');

    const items = await within(issues).findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Critical: The books do not balance');
    expect(items[0]).toHaveTextContent(
      'Credits and debits differ by -0.01 TRY in the selected period.',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('The books do not balance'),
      expect.stringContaining('1 trade was refused by billing'),
      expect.stringContaining('1 trade is waiting for billing to confirm'),
      expect.stringContaining('2 meter events are waiting to be delivered'),
    ]);

    await user.click(within(items[0]!).getByRole('button', { name: /Billing/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument();
  });

  it('shows the grid in four figures, exactly as the services reported them', async () => {
    await overview();
    const grid = await screen.findByText('Grid overview');
    const card = grid.closest('.rounded-lg') as HTMLElement;

    expect(await within(card).findByText('1,234.500')).toBeInTheDocument();
    expect(within(card).getByText('987.250')).toBeInTheDocument();
    expect(within(card).getByText('247.250')).toBeInTheDocument();
    expect(within(card).getByText('15.000')).toBeInTheDocument();
    expect(within(card).getByText('Surplus:')).toBeInTheDocument();
    expect(
      within(card).getByText('Sold between neighbours and settled, in 2 trades.'),
    ).toBeInTheDocument();
    expect(within(card).getByText('Last 24 hours')).toBeInTheDocument();
  });

  it('shows where the energy went, from panels to market to use', async () => {
    await overview();
    const flow = region('Energy flow');

    const steps = await within(flow).findAllByRole('listitem');
    const values = steps.map((step) => step.textContent);
    expect(values[0]).toContain('Produced');
    expect(values[0]).toContain('1,234.500kWh');
    expect(values.find((text) => text?.startsWith('Offered'))).toContain('27.000kWh');
    expect(values.find((text) => text?.startsWith('Traded'))).toContain(
      '2.000 kWh committed to trades, waiting for billing.',
    );
    expect(values.find((text) => text?.startsWith('Requested'))).toContain('16.000kWh');
    expect(
      within(flow).getByRole('img', {
        name: '17.000 kWh matched and 10.000 kWh still unsold, of the offered energy',
      }),
    ).toBeInTheDocument();
  });

  it('sums up the market, trading and billing, each a click from its page', async () => {
    const user = userEvent.setup();
    await overview();

    expect(await screen.findByText('Price right now')).toBeInTheDocument();
    expect(screen.getAllByText('6.0000').length).toBeGreaterThan(0);
    expect(screen.getByText('Trades made')).toBeInTheDocument();
    expect(screen.getByText('Money settled')).toBeInTheDocument();
    expect(await screen.findByText('Books balanced')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open trading' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trading' })).toBeInTheDocument();
  });

  it('shows placeholders while the first answers are on their way', async () => {
    const never = () => new Promise(() => undefined);
    await overview({ api: fakeApi({ energySummary: vi.fn(never), tradeSummary: vi.fn(never) }) });

    expect(screen.getByText('Loading production')).toBeInTheDocument();
    expect(screen.getByText('Loading traded energy')).toBeInTheDocument();
    expect(screen.getByText('Loading the energy flow')).toBeInTheDocument();
  });
});

describe('when something is down', () => {
  it('names each service that is not ready, and what that stops', async () => {
    await overview({
      api: fakeApi({ readiness: readinessBy({ pricing: 'unreachable', billing: 'not_ready' }) }),
    });
    const status = region('System status');

    expect(await within(status).findByText('System degraded')).toBeInTheDocument();
    expect(within(status).getByText('2 of 4 services ready')).toBeInTheDocument();
    expect(within(status).getByText('Unavailable')).toBeInTheDocument();
    expect(within(status).getByText('Degraded')).toBeInTheDocument();

    const issues = region('Issues');
    expect(within(issues).getByText('Pricing engine is not responding')).toBeInTheDocument();
    expect(
      within(issues).getByText(
        'The market price cannot be looked up, so no new trades can be matched.',
      ),
    ).toBeInTheDocument();
    expect(
      within(issues).getByText('Billing ledger cannot reach its database'),
    ).toBeInTheDocument();
  });

  it('says the system is unavailable when no service answers', async () => {
    await overview({
      api: fakeApi({
        readiness: readinessBy({
          smartMeter: 'unreachable',
          pricing: 'unreachable',
          tradeMatching: 'unreachable',
          billing: 'unreachable',
        }),
      }),
    });

    expect(
      await within(region('System status')).findByText('System unavailable'),
    ).toBeInTheDocument();
    expect(within(region('System status')).getByText('0 of 4 services ready')).toBeInTheDocument();
  });

  it('keeps the rest of the page when one service fails, and says what is missing', async () => {
    const api = fakeApi({
      energySummary: vi.fn(async () =>
        Promise.reject(apiError('network', 'Smart meter could not be reached.')),
      ),
    });
    await overview({ api });

    expect(await screen.findAllByText('Smart meter could not be reached.')).not.toHaveLength(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(3);
    // The market figures still arrive.
    expect(await screen.findByText('Trades made')).toBeInTheDocument();
    expect(
      within(region('Issues')).getByText('Energy statistics could not be loaded'),
    ).toBeInTheDocument();
  });
});

describe('the period', () => {
  const lastWindow = (fn: unknown) =>
    (fn as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as StatsWindow;
  const hours = (window: StatsWindow) =>
    (Date.parse(window.to) - Date.parse(window.from)) / 3_600_000;

  it('starts with the last 24 hours in hourly buckets, in UTC', async () => {
    const { api } = await overview();
    await waitFor(() => expect(api.energySummary).toHaveBeenCalled());

    expect(hours(lastWindow(api.energySummary))).toBe(24);
    expect((api.energyTrend as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe('hour');
    expect(screen.getByRole('radio', { name: 'Last 24 hours' })).toBeChecked();
    expect(within(region('Period')).getByText(/Selected period:/)).toHaveTextContent(
      /UTC until .* UTC · hourly buckets · all times are UTC/,
    );
  });

  it('asks every service for the new period when a preset is chosen', async () => {
    const user = userEvent.setup();
    const { api } = await overview();
    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));

    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(2));
    for (const call of [
      api.energySummary,
      api.tradeSummary,
      api.priceSummary,
      api.billingSummary,
    ]) {
      expect(hours(lastWindow(call))).toBe(30 * 24);
    }
    expect((api.tradeTrend as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toBe('day');
    expect(await screen.findAllByText('Last 30 days')).not.toHaveLength(0);
  });

  it('applies custom dates, both days included', async () => {
    const user = userEvent.setup();
    const { api } = await overview();

    await user.click(screen.getByRole('radio', { name: 'Custom dates' }));
    const from = screen.getByLabelText('From (UTC)');
    const to = screen.getByLabelText('To, inclusive (UTC)');
    await user.clear(from);
    await user.type(from, '2026-09-01');
    await user.clear(to);
    await user.type(to, '2026-09-03');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastWindow(api.billingSummary)).toEqual({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-04T00:00:00.000Z',
      }),
    );
    expect(await screen.findAllByText('01 Sep – 03 Sep 2026')).not.toHaveLength(0);
  });

  it('explains dates it will not send', async () => {
    const user = userEvent.setup();
    const { api } = await overview();
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

  it('is not offered on the system page, whose figures are not for a period', async () => {
    await renderPage('system', 'System health');
    expect(screen.queryByRole('region', { name: 'Period' })).not.toBeInTheDocument();
  });
});

describe('refreshing', () => {
  it('fetches everything again on request, keeping the figures on screen meanwhile', async () => {
    const user = userEvent.setup();
    const { api } = await overview();
    await screen.findAllByText('1,234.500');

    await user.click(screen.getByRole('button', { name: 'Refresh all figures now' }));

    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(2));
    expect(api.readiness).toHaveBeenCalledTimes(8);
    await waitFor(() => expect(api.diagnostics).toHaveBeenCalledTimes(8));
    expect(screen.getAllByText('1,234.500')).not.toHaveLength(0);
    expect(await screen.findByText('just now')).toBeInTheDocument();
  });

  it('says how old the figures are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await overview();
    await screen.findByText('just now');

    await act(() => vi.advanceTimersByTimeAsync(12_000));

    expect(screen.getByText('12 s ago')).toBeInTheDocument();
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
    await overview({ autoRefreshMs: 1_000, api: fakeApi({ tradeSummary: slow }) });
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
    const { api } = await overview({ autoRefreshMs: 1_000 });
    const autoRefresh = screen.getByRole('switch', { name: /Auto refresh/ });
    expect(autoRefresh).toHaveAttribute('aria-checked', 'true');

    await act(async () => autoRefresh.click());
    expect(autoRefresh).toHaveAttribute('aria-checked', 'false');
    const calls = (api.tradeSummary as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(api.tradeSummary).toHaveBeenCalledTimes(calls);
  });

  it('pauses while the tab is hidden, and catches up when it is shown again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = await overview({ autoRefreshMs: 1_000 });
    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(1));
    const visibility = vi.spyOn(document, 'visibilityState', 'get');

    visibility.mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(api.tradeSummary).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(api.tradeSummary).toHaveBeenCalledTimes(2));
  });
});
