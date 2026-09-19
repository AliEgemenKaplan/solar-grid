import fs from 'node:fs';
import path from 'node:path';
import { corsOriginsFrom } from '../src/http/configure-http-app';

/**
 * The browser origins the Docker stack lets call its services.
 *
 * The operator dashboard runs on its own origin and calls each service with
 * the operator token, so the stack allows exactly that origin (and the Vite
 * dev server's) by default. This keeps the default from drifting into
 * something broader - a wildcard, a remote host - without anyone noticing.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'infrastructure', 'docker-compose.yml'), 'utf8');

/** The value compose uses when CORS_ALLOWED_ORIGINS is unset or empty, ports at their defaults. */
function defaultOrigins(): string[] {
  const line = /CORS_ALLOWED_ORIGINS: \$\{CORS_ALLOWED_ORIGINS:-(.*)\}$/m.exec(COMPOSE);
  if (!line) throw new Error('CORS_ALLOWED_ORIGINS has no default in docker-compose.yml');
  const resolved = line[1]!.replace(/\$\{DASHBOARD_PORT:-(\d+)\}/g, '$1');
  return corsOriginsFrom({ get: () => resolved } as never);
}

describe('the stack’s CORS default', () => {
  it('allows the dashboard and the Vite dev server, by explicit origin', () => {
    expect(defaultOrigins()).toEqual([
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://localhost:5173',
    ]);
  });

  it('allows nothing but this machine', () => {
    for (const origin of defaultOrigins()) {
      expect(new URL(origin).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
      expect(origin).not.toContain('*');
    }
  });

  it('follows the dashboard to another port', () => {
    expect(COMPOSE).toContain('http://localhost:${DASHBOARD_PORT:-8080}');
    expect(COMPOSE).toContain("'127.0.0.1:${DASHBOARD_PORT:-8080}:8080'");
  });

  it('builds the dashboard against the ports the services are published on', () => {
    for (const [variable, port] of [
      ['VITE_SMART_METER_API_URL', 'SMART_METER_PORT:-3001'],
      ['VITE_PRICING_API_URL', 'PRICING_PORT:-3002'],
      ['VITE_TRADE_MATCHING_API_URL', 'TRADE_MATCHING_PORT:-3003'],
      ['VITE_BILLING_API_URL', 'BILLING_PORT:-3004'],
    ]) {
      expect(COMPOSE).toContain(`${variable}: http://localhost:\${${port}}`);
    }
  });

  it('gives the dashboard container no credential at all', () => {
    const dashboard = COMPOSE.slice(
      COMPOSE.indexOf('\n  dashboard:\n'),
      COMPOSE.indexOf('\nvolumes:'),
    );
    expect(dashboard).not.toMatch(/TOKEN|PASSWORD|DATABASE_URL|RABBITMQ_URL/);
  });
});
