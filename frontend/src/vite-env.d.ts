/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SMART_METER_API_URL?: string;
  readonly VITE_PRICING_API_URL?: string;
  readonly VITE_TRADE_MATCHING_API_URL?: string;
  readonly VITE_BILLING_API_URL?: string;
  readonly VITE_REQUEST_TIMEOUT_MS?: string;
  readonly VITE_AUTO_REFRESH_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
