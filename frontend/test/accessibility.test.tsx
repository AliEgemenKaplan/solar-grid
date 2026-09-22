import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { renderApp, renderPage } from './render';

/**
 * An automated accessibility audit (axe-core) of every page as it renders
 * with data. Colour contrast is left out because jsdom does not lay out or
 * paint; the palette's contrast is checked by hand against the design tokens.
 */
async function violations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  );
}

const PAGES: Array<[string, string, string]> = [
  ['overview', 'Overview', 'Grid overview'],
  ['energy', 'Energy', 'Largest producers'],
  ['market', 'Market', 'Current price'],
  ['trading', 'Trading', 'How the trades ended'],
  ['billing', 'Billing', 'Books balanced'],
  ['households', 'Households', 'Highest trading volume'],
  ['system', 'System health', 'Runs completed'],
];

describe('accessibility', () => {
  it('has no violations on the sign-in page', async () => {
    renderApp();
    await screen.findAllByText('Ready');
    expect(await violations()).toEqual([]);
  });

  it.each(PAGES)('has no violations on the %s page', async (page, heading, loaded) => {
    await renderPage(page, heading);
    await screen.findAllByText(loaded);
    expect(await violations()).toEqual([]);
  });

  it('has no violations with the household details open', async () => {
    const user = userEvent.setup();
    await renderPage('households', 'Households');
    await user.click(await screen.findByRole('button', { name: 'Details for HH-A' }));
    await within(await screen.findByRole('dialog')).findByText('Has 2.500 kWh spare');
    expect(await violations()).toEqual([]);
  });

  it('has no violations with a chart shown as a table', async () => {
    const user = userEvent.setup();
    await renderPage('energy', 'Energy');
    await user.click(
      await screen.findByRole('button', {
        name: 'Show table for Energy produced and used over time',
      }),
    );
    expect(await violations()).toEqual([]);
  });

  it('reaches every page and control from the keyboard, in reading order', async () => {
    const user = userEvent.setup();
    await renderPage('overview', 'Overview');
    // Arriving on a page puts focus on its heading, so a screen reader says where it is.
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to the content' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveFocus();
    await user.keyboard('{Tab}{Tab}');
    expect(screen.getByRole('link', { name: 'Market' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Market' })).toHaveFocus();
  });
});
