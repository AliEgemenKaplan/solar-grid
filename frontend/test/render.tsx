import { render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { preloadPages } from '../src/app/ControlCenter';
import { createTokenStore } from '../src/auth/token-store';
import type { SolarGridApi } from '../src/services/solar-grid-api';
import { fakeApi, TEST_CONFIG } from './fixtures';

// The app loads the control center and each page lazily; loading them here up
// front keeps the first test in a file from spending its time budget
// compiling the charts, and navigation from waiting on a chunk.
await preloadPages();

export const OPERATOR_TOKEN = 'operator-token-for-tests-0123456789abcdef';

/**
 * The whole app, as main.tsx assembles it, with a fake API in place of the
 * network. `signedIn` starts it with a token already kept for the tab.
 */
export function renderApp({
  api = fakeApi(),
  signedIn = false,
  autoRefreshMs = TEST_CONFIG.autoRefreshMs,
}: { api?: SolarGridApi; signedIn?: boolean; autoRefreshMs?: number } = {}) {
  const tokens = createTokenStore(window.sessionStorage);
  if (signedIn) tokens.set(OPERATOR_TOKEN);
  const utils = render(
    <App services={{ api, config: { ...TEST_CONFIG, autoRefreshMs } }} tokens={tokens} />,
  );
  return { ...utils, api, tokens };
}

/** Signed in, on the page in the address (`#/market`), once its heading is on screen. */
export async function renderPage(
  page: string,
  heading: string,
  options: Parameters<typeof renderApp>[0] = {},
) {
  window.location.hash = `#/${page}`;
  const rendered = renderApp({ signedIn: true, ...options });
  await screen.findByRole('heading', { level: 1, name: heading });
  return rendered;
}
