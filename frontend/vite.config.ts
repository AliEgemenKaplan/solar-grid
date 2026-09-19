import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { API_URL_VARIABLES, DEFAULT_API_URLS } from './src/config/defaults.ts';

/**
 * A content security policy for the built page, written into index.html.
 *
 * The operator token lives in this tab's session storage, so the thing to
 * guard against is script that is not ours reading it. Scripts may only come
 * from this origin, and the page may only talk to this origin and the four
 * services it was built for. The origins come from the same variables the app
 * uses, so the policy cannot drift from the API configuration.
 *
 * Build only: the dev server injects inline scripts for hot reload. The
 * header-only directives (frame-ancestors) are set by nginx.
 */
function contentSecurityPolicy(apiUrls: string[]): Plugin {
  const connectSources = [...new Set(apiUrls.map((url) => new URL(url).origin))];
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Chart and layout libraries set style attributes at runtime; styles
    // cannot run code, so this is the one relaxation.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${connectSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return {
    name: 'solar-grid:content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }): UserConfig => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiUrls = (Object.keys(API_URL_VARIABLES) as Array<keyof typeof API_URL_VARIABLES>).map(
    (service) => env[API_URL_VARIABLES[service]] || DEFAULT_API_URLS[service],
  );

  return {
    plugins: [react(), tailwindcss(), contentSecurityPolicy(apiUrls)],
    // The Docker stack allows these two origins by default; a different port
    // would need CORS_ALLOWED_ORIGINS changed to match.
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { sourcemap: false },
  };
});
