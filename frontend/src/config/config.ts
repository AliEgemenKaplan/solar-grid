import {
  API_URL_VARIABLES,
  DEFAULT_API_URLS,
  DEFAULT_AUTO_REFRESH_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './defaults';

export type ServiceName = keyof typeof DEFAULT_API_URLS;

export const SERVICE_NAMES: readonly ServiceName[] = [
  'smartMeter',
  'pricing',
  'tradeMatching',
  'billing',
];

/** How each service is named in the interface. */
export const SERVICE_LABELS: Record<ServiceName, string> = {
  smartMeter: 'Smart meter',
  pricing: 'Pricing engine',
  tradeMatching: 'Trade matching',
  billing: 'Billing ledger',
};

export interface DashboardConfig {
  apiUrls: Record<ServiceName, string>;
  requestTimeoutMs: number;
  autoRefreshMs: number;
}

type Environment = Partial<Record<string, string | undefined>>;

/**
 * The dashboard's configuration, from build-time VITE_* variables.
 *
 * Those variables are public: they are compiled into the JavaScript every
 * visitor downloads. Only addresses and timings belong in them, never a token.
 * A malformed value stops the app with a message naming the variable rather
 * than sending requests somewhere unexpected.
 */
export function readConfig(env: Environment = import.meta.env): DashboardConfig {
  const apiUrls = {} as Record<ServiceName, string>;
  for (const service of SERVICE_NAMES) {
    const variable = API_URL_VARIABLES[service];
    const raw = env[variable]?.trim() || DEFAULT_API_URLS[service];
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${variable} is not a valid URL.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${variable} must be an http or https URL.`);
    }
    apiUrls[service] = raw.replace(/\/+$/, '');
  }

  return {
    apiUrls,
    requestTimeoutMs: positiveInteger(
      env.VITE_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      'VITE_REQUEST_TIMEOUT_MS',
    ),
    autoRefreshMs: positiveInteger(
      env.VITE_AUTO_REFRESH_MS,
      DEFAULT_AUTO_REFRESH_MS,
      'VITE_AUTO_REFRESH_MS',
    ),
  };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number of milliseconds.`);
  }
  return value;
}
