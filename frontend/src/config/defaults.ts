/**
 * Where each service listens on the operator's machine when the Docker stack
 * is running. Used when the matching VITE_* variable is not set, by the app and
 * by the build (which derives the page's content security policy from them).
 */
export const DEFAULT_API_URLS = {
  smartMeter: 'http://localhost:3001',
  pricing: 'http://localhost:3002',
  tradeMatching: 'http://localhost:3003',
  billing: 'http://localhost:3004',
} as const;

export const API_URL_VARIABLES = {
  smartMeter: 'VITE_SMART_METER_API_URL',
  pricing: 'VITE_PRICING_API_URL',
  tradeMatching: 'VITE_TRADE_MATCHING_API_URL',
  billing: 'VITE_BILLING_API_URL',
} as const;

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_AUTO_REFRESH_MS = 30_000;

/**
 * Solar Grid settles in one currency (docs/analytics.md, "Single currency").
 * Summaries report it; per-household lists do not repeat it, so their money
 * columns are labelled with this.
 */
export const SETTLEMENT_CURRENCY = 'TRY';
