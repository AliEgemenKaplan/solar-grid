import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  apiError,
  billingSummary,
  diagnosticsSnapshots,
  energyHouseholds,
  fakeApi,
  ok,
  page,
  readiness,
  tradeTrend,
  tradingHouseholds,
} from './fixtures';
import { OPERATOR_TOKEN, renderPage } from './render';

const main = () => screen.getByRole('main');
const section = (name: string) => screen.getByRole('region', { name });
const rows = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .queryAllByRole('cell')
        .map((cell) => cell.textContent),
    );

describe('the energy page', () => {
  it('shows the balance of the period, exactly as the smart meter reported it', async () => {
    await renderPage('energy', 'Energy');
    const balance = section('Energy balance');

    expect(await within(balance).findByText('1,234.500')).toBeInTheDocument();
    expect(within(balance).getByText('987.250')).toBeInTheDocument();
    expect(within(balance).getByText('247.250')).toBeInTheDocument();
    expect(within(balance).getByText('More produced than used.')).toBeInTheDocument();
    expect(within(balance).getByText('12')).toBeInTheDocument();
    expect(within(balance).getByText('240')).toBeInTheDocument();
    expect(within(balance).getByText('18 Sep 2026, 12:05 UTC')).toBeInTheDocument();
  });

  it('draws production and use, and net energy, each with a table of every value', async () => {
    const user = userEvent.setup();
    await renderPage('energy', 'Energy');
    const over = section('Production and use over time');

    expect(
      await within(over).findByRole('list', { name: 'Energy produced and used over time legend' }),
    ).toHaveTextContent('ProducedUsed');
    expect(over.querySelectorAll('.recharts-area')).toHaveLength(2);
    expect(over.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    await user.click(within(over).getByRole('button', { name: /Show table/ }));
    expect(rows(within(over).getByRole('table'))).toEqual([
      ['19 Sep 09:00 UTC, 1 hour', '2', '13.000', '7.000'],
      // The quiet hour is a row of zeros, as the API reported it.
      ['19 Sep 10:00 UTC, 1 hour', '0', '0.000', '0.000'],
      ['19 Sep 11:00 UTC, 1 hour', '1', '1.000', '5.000'],
    ]);

    const net = section('Net energy over time');
    await user.click(within(net).getByRole('button', { name: /Show table/ }));
    expect(rows(within(net).getByRole('table')).map((row) => row.slice(1, 3))).toEqual([
      ['6.000', expect.stringContaining('More produced')],
      ['0.000', expect.any(String)],
      ['-4.000', 'More used than produced'],
    ]);
  });

  it('says so when net energy was zero throughout, instead of drawing flat bars', async () => {
    const { energyTrend } = await import('./fixtures');
    const even = {
      ...energyTrend,
      buckets: energyTrend.buckets.map((bucket) => ({ ...bucket, netKwh: '0.000' })),
    };
    await renderPage('energy', 'Energy', {
      api: fakeApi({ energyTrend: vi.fn(async () => ok(even)) }),
    });

    expect(
      await within(section('Net energy over time')).findByText(
        'Net energy was 0 kWh in every hour with readings.',
      ),
    ).toBeInTheDocument();
  });

  it('compares spare energy, energy needed and energy traded on one scale', async () => {
    await renderPage('energy', 'Energy');
    const compare = section('Spare energy and demand');

    expect(await within(compare).findByText('400.000')).toBeInTheDocument();
    expect(within(compare).getByText('152.750')).toBeInTheDocument();
    expect(within(compare).getByText('15.000')).toBeInTheDocument();
  });

  it('ranks households by production, in the order the service gives', async () => {
    await renderPage('energy', 'Energy');
    expect(
      await within(section('By household')).findByRole('button', {
        name: '1. HH-A: 13.000 kWh produced. Show details.',
      }),
    ).toBeInTheDocument();
  });
});

describe('the market page', () => {
  it('shows the price now, where it sits between floor and ceiling, and what set it', async () => {
    await renderPage('market', 'Market');
    const now = section('Price now');

    expect(await within(now).findAllByText('Current price')).toHaveLength(2);
    expect(
      within(now).getByText(
        'Calculated 19 Sep 2026, 11:00 UTC, from 30.000 kWh offered and 60.000 kWh wanted.',
      ),
    ).toBeInTheDocument();
    expect(
      within(now).getByRole('figure', {
        name: 'Current price 6.0000 TRY/kWh, in a range from 2.5000 to 7.0000 TRY/kWh',
      }),
    ).toBeInTheDocument();
    expect(
      within(now).getByText('Period average 4.0000 · Paid on average 4.3333'),
    ).toBeInTheDocument();
    expect(within(now).getByText('Now 6.0000')).toBeInTheDocument();
  });

  it('says so when no pricing rule is active, instead of drawing a band', async () => {
    const { priceSummary } = await import('./fixtures');
    await renderPage('market', 'Market', {
      api: fakeApi({ priceSummary: vi.fn(async () => ok({ ...priceSummary, band: null })) }),
    });
    expect(
      await within(section('Price now')).findByText(/No pricing rule is active/),
    ).toBeInTheDocument();
  });

  it('draws every measure on its own chart with one axis, crosshairs in step', async () => {
    await renderPage('market', 'Market');

    await waitFor(() => expect(main().querySelectorAll('svg.recharts-surface')).toHaveLength(5));
    const titles = [...main().querySelectorAll('svg.recharts-surface > title')].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual([
      'Price over time',
      'Supply and demand behind the price',
      'Energy traded',
      'Money traded',
      'Average trade price',
    ]);
    for (const surface of main().querySelectorAll('.recharts-wrapper')) {
      expect(surface.querySelectorAll('.recharts-yAxis')).toHaveLength(1);
    }
  });

  it('leaves an hour with no trades as a gap, not a price of zero', async () => {
    const user = userEvent.setup();
    await renderPage('market', 'Market');
    const traded = section('Traded in the market');
    await within(traded).findAllByRole('button', { name: /Show table/ });

    await user.click(
      within(traded).getByRole('button', { name: 'Show table for Average trade price' }),
    );
    expect(rows(within(traded).getByRole('table')).map((row) => row[1])).toEqual(
      tradeTrend.buckets.map((bucket) => bucket.averagePricePerKwh ?? '—'),
    );
  });

  it('says so when nothing traded, instead of drawing empty charts', async () => {
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
    await renderPage('market', 'Market', {
      api: fakeApi({ tradeTrend: vi.fn(async () => ok(quiet)) }),
    });

    expect(
      await within(section('Traded in the market')).findAllByText(
        'No trades were settled in this period.',
      ),
    ).toHaveLength(3);
  });
});

describe('the trading page', () => {
  it('counts the trades, what they moved, and what is still reserved', async () => {
    await renderPage('trading', 'Trading');
    const trades = section('Trades in the period');

    expect(await within(trades).findByText('4')).toBeInTheDocument();
    expect(within(trades).getByText('15.000')).toBeInTheDocument();
    expect(within(trades).getByText('65.00')).toBeInTheDocument();
    expect(within(trades).getByText('2.000')).toBeInTheDocument();
    expect(
      within(trades).getByText('6.00 TRY in 1 trade waiting for billing.'),
    ).toBeInTheDocument();
  });

  it('shows how every trade ended, as parts of the whole with their meaning', async () => {
    await renderPage('trading', 'Trading');
    const outcomes = section('How the trades ended');

    expect(
      await within(outcomes).findByRole('img', {
        name: 'Settled: 2 of 4, Waiting for billing: 1 of 4, Refused: 1 of 4',
      }),
    ).toBeInTheDocument();
    expect(within(outcomes).getByText('50%')).toBeInTheDocument();
    expect(within(outcomes).getAllByText('25%')).toHaveLength(2);
    expect(
      within(outcomes).getByText(
        'Billing refused the trade, so its energy went back to the market.',
      ),
    ).toBeInTheDocument();
  });

  it('shows how much supply and demand found a match', async () => {
    await renderPage('trading', 'Trading');
    const book = section('Supply and demand');

    expect(
      await within(book).findByRole('img', {
        name: '17.000 kWh matched and 10.000 kWh still unsold',
      }),
    ).toBeInTheDocument();
    expect(
      within(book).getByRole('img', { name: '15.000 kWh matched and 1.000 kWh still unmet' }),
    ).toBeInTheDocument();
    expect(
      within(book).getByText('4 entries: 1 fully matched, 2 partly matched, 1 not matched yet.'),
    ).toBeInTheDocument();
  });

  it('says so when no trade was made, rather than showing empty bars', async () => {
    const { tradeSummary } = await import('./fixtures');
    await renderPage('trading', 'Trading', {
      api: fakeApi({
        tradeSummary: vi.fn(async () =>
          ok({ ...tradeSummary, trades: { total: 0, completed: 0, pendingBilling: 0, failed: 0 } }),
        ),
      }),
    });
    expect(
      await within(section('How the trades ended')).findByText(
        'No trades were made in this period.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the billing page', () => {
  it('says the books balance only when the ledger net is exactly zero', async () => {
    await renderPage('billing', 'Billing');

    expect(await screen.findByText('Books balanced')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Credits to sellers equal debits from buyers: 65.00 TRY each, over 4 ledger entries.',
      ),
    ).toBeInTheDocument();
  });

  it('flags books that do not balance, with the amount', async () => {
    const unbalanced = { ...billingSummary, ledger: { ...billingSummary.ledger, net: '-0.01' } };
    await renderPage('billing', 'Billing', {
      api: fakeApi({ billingSummary: vi.fn(async () => ok(unbalanced)) }),
    });

    expect(await screen.findByText('Books not balanced')).toBeInTheDocument();
    expect(screen.getByText(/Credits and debits differ by -0.01 TRY/)).toBeInTheDocument();
    expect(screen.queryByText('Books balanced')).not.toBeInTheDocument();
  });

  it('claims nothing about balance when nothing was settled', async () => {
    const empty = {
      ...billingSummary,
      ledger: { entries: 0, credited: '0.00', debited: '0.00', net: '0.00', households: 0 },
    };
    await renderPage('billing', 'Billing', {
      api: fakeApi({ billingSummary: vi.fn(async () => ok(empty)) }),
    });

    expect(await screen.findByText('No ledger entries in this period')).toBeInTheDocument();
    expect(screen.queryByText('Books balanced')).not.toBeInTheDocument();
  });

  it('keeps the period and the balances as they stand now apart', async () => {
    await renderPage('billing', 'Billing');
    const period = section('Settled in the period');
    const now = section('Balances right now');

    expect(await within(period).findByText('Money settled')).toBeInTheDocument();
    expect(within(period).getByText('Credits')).toBeInTheDocument();
    expect(within(period).getByText('Debits')).toBeInTheDocument();
    expect(within(now).getByText(/not only the selected period/)).toBeInTheDocument();
    expect(within(now).getByText('In credit').closest('div')).toHaveTextContent(
      'In credit2' + '65.00 TRY in total',
    );
    expect(within(now).getByText('In debit').closest('div')).toHaveTextContent('1');
    expect(within(now).getByText('Even').closest('div')).toHaveTextContent('1');
  });

  it('draws money and energy settled over time', async () => {
    const user = userEvent.setup();
    await renderPage('billing', 'Billing');
    const over = section('Settled over time');

    await user.click(
      await within(over).findByRole('button', { name: 'Show table for Money settled' }),
    );
    expect(rows(within(over).getByRole('table')).map((row) => row.slice(1))).toEqual([
      ['40.00', '1'],
      ['0.00', '0'],
      ['25.00', '1'],
    ]);
  });
});

describe('the households page', () => {
  it('counts households by what each service saw them do', async () => {
    await renderPage('households', 'Households');
    const counts = section('Households in the period');

    const figure = async (label: string) =>
      (await within(counts).findByText(label)).closest('div')!.textContent;
    expect(await figure('Sent meter readings')).toContain('12');
    expect(await figure('Part of a trade')).toContain('4');
    expect(await figure('Settled a trade')).toContain('3');
    expect(await figure('Have a balance')).toContain('4');
  });

  it('lists households one page at a time', async () => {
    const user = userEvent.setup();
    const tradeHouseholds = vi.fn(async (query: { page: number; limit: number }) =>
      ok(page(tradingHouseholds, 25, query.page, query.limit)),
    );
    await renderPage('households', 'Households', { api: fakeApi({ tradeHouseholds }) });
    const list = section('All households');

    expect(await within(list).findByRole('rowheader', { name: 'HH-A' })).toBeInTheDocument();
    expect(within(list).getByText('1–10 of 25 households')).toBeInTheDocument();
    // Energy traded is sold plus bought, added exactly.
    expect(within(list).getAllByText('10.000 kWh').length).toBeGreaterThan(0);

    await user.click(within(list).getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(tradeHouseholds.mock.calls.at(-1)![0]).toMatchObject({ page: 2, limit: 10 }),
    );
  });

  it('switches between trading, energy and billing, by keyboard too', async () => {
    const user = userEvent.setup();
    const { api } = await renderPage('households', 'Households');
    const list = section('All households');
    const trading = await within(list).findByRole('tab', { name: 'Trading' });
    expect(trading).toHaveAttribute('aria-selected', 'true');

    trading.focus();
    await user.keyboard('{ArrowRight}');

    expect(within(list).getByRole('tab', { name: 'Energy' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await within(list).findByRole('columnheader', { name: 'Produced' })).toBeInTheDocument();
    expect(api.energyHouseholds).toHaveBeenCalled();
  });

  it('finds one household, and refuses an id the services would reject', async () => {
    const user = userEvent.setup();
    const { api } = await renderPage('households', 'Households');
    const list = section('All households');
    await within(list).findByRole('rowheader', { name: 'HH-A' });

    await user.type(within(list).getByLabelText('Household id'), 'HH A;--');
    await user.click(within(list).getByRole('button', { name: 'Find' }));
    expect(within(list).getByRole('alert')).toHaveTextContent('Use letters, digits');

    await user.clear(within(list).getByLabelText('Household id'));
    await user.type(within(list).getByLabelText('Household id'), 'HH-B');
    await user.click(within(list).getByRole('button', { name: 'Find' }));
    await waitFor(() =>
      expect((api.tradeHouseholds as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject(
        {
          householdId: 'HH-B',
          page: 1,
        },
      ),
    );
  });

  it('says so when no household traded', async () => {
    await renderPage('households', 'Households', {
      api: fakeApi({ tradeHouseholds: vi.fn(async () => ok(page([], 0))) }),
    });
    expect(
      await within(section('All households')).findByText(
        'No household completed a trade in this period.',
      ),
    ).toBeInTheDocument();
  });

  it('opens everything known about one household, and closes back where it was', async () => {
    const user = userEvent.setup();
    const { api } = await renderPage('households', 'Households');
    const details = await within(section('All households')).findByRole('button', {
      name: 'Details for HH-A',
    });

    await user.click(details);
    const drawer = await screen.findByRole('dialog', { name: 'HH-A' });

    expect(await within(drawer).findByText('Has 2.500 kWh spare')).toBeInTheDocument();
    expect(within(drawer).getByText('Balance').closest('div')).toHaveTextContent('Balance40.00TRY');
    expect(
      within(drawer).getByText(
        'In credit: has earned more selling energy than it has spent buying.',
      ),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('13.000')).toBeInTheDocument();
    expect(api.householdStatus).toHaveBeenCalledWith('HH-A', expect.any(AbortSignal));
    expect(api.tradeHouseholds).toHaveBeenLastCalledWith(
      expect.objectContaining({ householdId: 'HH-A', limit: 1 }),
      expect.any(AbortSignal),
    );
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(details).toHaveFocus();
  });

  it('shows what it can about a household when one service cannot answer', async () => {
    const user = userEvent.setup();
    await renderPage('households', 'Households', {
      api: fakeApi({
        householdStatus: vi.fn(async () => null),
        householdBalance: vi.fn(async () =>
          Promise.reject(apiError('network', 'Billing ledger could not be reached.')),
        ),
      }),
    });

    await user.click(
      await within(section('All households')).findByRole('button', { name: 'Details for HH-A' }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'HH-A' });

    expect(
      await within(drawer).findByText('This household has never sent a meter reading.'),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText('Not available: Billing ledger could not be reached.'),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('13.000')).toBeInTheDocument();
  });

  it('opens a household from the rankings too', async () => {
    const user = userEvent.setup();
    await renderPage('households', 'Households');

    await user.click(
      await within(section('Rankings')).findByRole('button', {
        name: '1. HH-A: 40.00 received, 0.00 paid. Show details.',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'HH-A' })).toBeInTheDocument();
    expect(energyHouseholds[0]!.householdId).toBe('HH-A');
  });
});

describe('the system health page', () => {
  it('describes each service, its state in words, its response time and dependencies', async () => {
    await renderPage('system', 'System health');
    const services = await screen.findByRole('list', { name: 'Services' });

    const cards = within(services).getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent('Smart meter');
    expect(cards[0]).toHaveTextContent('Ready');
    expect(cards[0]).toHaveTextContent('Receives readings from household meters');
    expect(cards[0]).toHaveTextContent('7 ms');
    expect(cards[0]).toHaveTextContent('Database: up');
  });

  it('lists what needs attention without a link back to the page it is on', async () => {
    await renderPage('system', 'System health');
    const issues = screen.getByRole('region', { name: 'Issues' });

    const waiting = await within(issues).findByText('2 meter events are waiting to be delivered');
    expect(within(waiting.closest('li')!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('says which dependency a degraded service cannot reach', async () => {
    await renderPage('system', 'System health', {
      api: fakeApi({
        readiness: vi.fn(async (service: string) =>
          service === 'billing'
            ? {
                report: readiness(service, 'not_ready'),
                httpStatus: 503,
                latencyMs: 9,
                error: null,
              }
            : { report: readiness(service), httpStatus: 200, latencyMs: 7, error: null },
        ),
      }),
    });
    const services = await screen.findByRole('list', { name: 'Services' });
    const billing = within(services).getAllByRole('listitem')[3]!;

    expect(billing).toHaveTextContent('Billing ledger');
    expect(billing).toHaveTextContent('Degraded');
    expect(billing).toHaveTextContent('Cannot reach: database.');
    expect(billing).toHaveTextContent('Database: down');
  });

  it('follows a meter reading through the message broker to trade matching', async () => {
    await renderPage('system', 'System health');
    const events = section('Messages and events');

    const figure = async (label: string) =>
      (await within(events).findByText(label)).closest('div')!.textContent;
    expect(await figure('New readings')).toContain('240');
    expect(await figure('Repeats ignored')).toContain('3');
    expect(await figure('Delivered')).toContain('238');
    expect(await figure('Delivery attempts failed')).toContain('1');
    expect(await figure('Waiting now')).toContain('2');
    expect(await figure('Processed')).toContain('238');
    expect(await figure('Retries scheduled')).toContain('2');
    // Not in the counters because nothing was set aside: zero, not "not reported".
    expect(await figure('Set aside')).toContain('0');
    expect(
      within(events).getByText('Counted since smart meter started, 19 Sep 2026, 08:00 UTC.'),
    ).toBeInTheDocument();
    expect(within(events).getByText(/management interface are not exposed/)).toBeInTheDocument();
  });

  it('shows the work each service has done', async () => {
    await renderPage('system', 'System health');
    const operations = section('Operations');

    const figure = async (label: string) =>
      (await within(operations).findByText(label)).closest('div')!.textContent;
    expect(await figure('Runs completed')).toContain('30');
    expect(await figure('Runs stopped: no price')).toContain('1');
    expect(await figure('Trades reserved')).toContain('4');
    expect(await figure('Trades recorded')).toContain('2');
    expect(await figure('Repeats answered')).toContain('1');
    expect(await figure('Price recalculations')).toContain('36');
  });

  it('gives engineers requests, response times and dependency failures, folded away', async () => {
    const user = userEvent.setup();
    await renderPage('system', 'System health');

    const summary = screen.getByText('Engineering diagnostics');
    await user.click(summary);
    const table = await screen.findByRole('table', {
      name: 'Requests and dependency failures per service',
    });
    expect(
      within(table).getByRole('rowheader', { name: 'Smart meter' }).closest('tr'),
    ).toHaveTextContent('Smart meter1009820' + '12 ms' + 'None');
    expect(
      within(table).getByRole('rowheader', { name: 'Trade matching' }).closest('tr'),
    ).toHaveTextContent('Billing ledger: 1');
  });

  it('says which service did not report its counters, and shows the rest', async () => {
    await renderPage('system', 'System health', {
      api: fakeApi({
        diagnostics: vi.fn(async (service: string) =>
          service === 'pricing'
            ? Promise.reject(apiError('network', 'Pricing engine could not be reached.'))
            : ok(diagnosticsSnapshots[service]!),
        ),
      }),
    });

    expect(
      await screen.findByText(
        'Pricing engine did not report its counters. Pricing engine could not be reached.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Issues' })).getByText(
        'Pricing engine did not report its counters',
      ),
    ).toBeInTheDocument();
    expect(await within(section('Operations')).findByText('Runs completed')).toBeInTheDocument();
  });

  it('shows no token, correlation id or internal address anywhere', async () => {
    const user = userEvent.setup();
    await renderPage('system', 'System health');
    await within(section('Operations')).findByText('Runs completed');
    await user.click(screen.getByText('Engineering diagnostics'));

    const text = document.body.textContent ?? '';
    expect(document.body.innerHTML).not.toContain(OPERATOR_TOKEN);
    expect(text).not.toMatch(/correlation|Bearer|password|postgres|amqp:|guest/i);
  });
});
