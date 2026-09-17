#!/usr/bin/env node
// Creates infrastructure/.env from infrastructure/.env.example, generating a
// random value for every secret that is empty.
//
//   pnpm env:init
//
// Safe to run again: a value already set in .env is never changed, settings
// added to the example since are appended, and nothing is printed but the
// names of the variables that were filled in.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const infrastructure = join(dirname(fileURLToPath(import.meta.url)), '..', 'infrastructure');
const examplePath = join(infrastructure, '.env.example');
const envPath = join(infrastructure, '.env');

/** Filled with 32 random bytes as hex: long, and safe inside a connection URL. */
const SECRETS = new Set([
  'POSTGRES_PASSWORD',
  'SMART_METER_DB_PASSWORD',
  'PRICING_DB_PASSWORD',
  'MATCHING_DB_PASSWORD',
  'LEDGER_DB_PASSWORD',
  'RABBITMQ_PASSWORD',
  'OPERATOR_API_TOKEN',
  'INTERNAL_API_TOKEN',
  'METRICS_TOKEN',
]);

const ASSIGNMENT = /^([A-Z][A-Z0-9_]*)=(.*)$/;

function parse(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

const example = readFileSync(examplePath, 'utf8');
const existingText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = parse(existingText);

const generated = [];
const lines = example.split(/\r?\n/).map((line) => {
  const match = ASSIGNMENT.exec(line);
  if (!match) return line;
  const [, name, exampleValue] = match;

  const current = existing.get(name);
  if (current !== undefined && current !== '') return `${name}=${current}`;
  if (SECRETS.has(name)) {
    generated.push(name);
    return `${name}=${randomBytes(32).toString('hex')}`;
  }
  return `${name}=${current ?? exampleValue}`;
});

// Anything set in .env that the example does not know about is kept.
const known = parse(example);
const extras = [...existing].filter(([name]) => !known.has(name));
if (extras.length > 0) {
  lines.push('', '# --- Local additions ---', ...extras.map(([name, value]) => `${name}=${value}`));
}

writeFileSync(envPath, `${lines.join('\n').trimEnd()}\n`, { mode: 0o600 });

console.log(existingText ? `Updated ${envPath}` : `Created ${envPath}`);
console.log(
  generated.length > 0
    ? `Generated: ${generated.join(', ')}`
    : 'No secrets needed generating; existing values were kept.',
);
