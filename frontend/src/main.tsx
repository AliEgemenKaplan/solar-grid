import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createTokenStore } from './auth/token-store';
import { readConfig, type DashboardConfig } from './config/config';
import { ApiClient } from './services/api-client';
import { createSolarGridApi } from './services/solar-grid-api';
import './styles/index.css';

const root = createRoot(document.getElementById('root')!);

let config: DashboardConfig | null = null;
try {
  config = readConfig();
} catch (error) {
  // A build with a malformed API address says so instead of calling it.
  root.render(
    <main className="p-8 text-sm text-ink">
      <h1 className="font-semibold">The dashboard is misconfigured.</h1>
      <p className="mt-2 text-ink-2">
        {error instanceof Error ? error.message : 'Unknown configuration error.'}
      </p>
    </main>,
  );
}

if (config) {
  const tokens = createTokenStore();
  const client = new ApiClient({ config, getToken: tokens.get });
  root.render(
    <StrictMode>
      <App services={{ api: createSolarGridApi(client), config }} tokens={tokens} />
    </StrictMode>,
  );
}
