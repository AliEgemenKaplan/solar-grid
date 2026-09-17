import fs from 'node:fs';
import path from 'node:path';

/**
 * Every service must be handed the credentials it checks.
 *
 * A service declares what it checks in `configureHttpApp({ credentials })`,
 * and compose decides what reaches its container. When those two disagree the
 * service still starts: the token it never received matches nothing, so the
 * endpoint answers 401 to everyone, including the operator holding the right
 * token. That is exactly what happened when the statistics endpoints were
 * added to two services that had never needed the operator token before, and
 * it only showed up in the Docker stack.
 *
 * This reads both files and compares them, so the next time it happens it
 * fails here instead.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'infrastructure', 'docker-compose.yml'), 'utf8');

const TOKEN_OF: Record<string, string> = {
  operator: 'OPERATOR_API_TOKEN',
  'internal-service': 'INTERNAL_API_TOKEN',
  metrics: 'METRICS_TOKEN',
};

const SERVICES = [
  { app: 'smart-meter-service', compose: 'smart-meter-service' },
  { app: 'pricing-engine-service', compose: 'pricing-engine-service' },
  { app: 'trade-matching-service', compose: 'trade-matching-service' },
  { app: 'billing-ledger-service', compose: 'billing-ledger-service' },
];

/** The lines of a block introduced by `key:`, until the indentation returns. */
function blockAfter(text: string, heading: RegExp): string {
  const match = heading.exec(text);
  if (!match) throw new Error(`no block matching ${heading} in docker-compose.yml`);
  const start = match.index + match[0].length;
  const indent = match[0].match(/\n?( *)\S/)?.[1].length ?? 0;
  const lines: string[] = [];
  for (const line of text.slice(start).split('\n')) {
    const content = line.trim();
    if (content.length > 0 && line.search(/\S/) <= indent) break;
    lines.push(line);
  }
  return lines.join('\n');
}

/** Token variables a container is given, the shared anchor included. */
function tokensReaching(service: string): Set<string> {
  const environment = blockAfter(
    blockAfter(COMPOSE, new RegExp(`\\n {2}${service}:\\n`)),
    /\n {4}environment:\n/,
  );
  const shared = environment.includes('<<: *http-platform')
    ? blockAfter(COMPOSE, /\nx-http-platform: &http-platform\n/)
    : '';
  return new Set(
    [...`${environment}\n${shared}`.matchAll(/^\s*([A-Z_]+):/gm)]
      .map((match) => match[1])
      .filter((name) => Object.values(TOKEN_OF).includes(name)),
  );
}

/** Credentials the service tells configureHttpApp it checks or sends. */
function tokensDeclared(app: string): Set<string> {
  const main = fs.readFileSync(path.join(ROOT, 'apps', app, 'src', 'main.ts'), 'utf8');
  const declaration = /credentials:\s*\[([^\]]*)\]/.exec(main);
  if (!declaration) throw new Error(`${app} does not declare credentials`);
  return new Set(
    [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => {
      const token = TOKEN_OF[match[1]];
      if (!token) throw new Error(`${app} declares an unknown credential: ${match[1]}`);
      return token;
    }),
  );
}

describe('deployment credentials', () => {
  it.each(SERVICES)('gives $compose exactly the tokens it declares', ({ app, compose }) => {
    expect([...tokensReaching(compose)].sort()).toEqual([...tokensDeclared(app)].sort());
  });

  it('requires every token rather than defaulting it', () => {
    for (const token of Object.values(TOKEN_OF)) {
      // ${VAR:?message}: compose refuses to start without it.
      const occurrences = [
        ...COMPOSE.matchAll(new RegExp(`${token}: \\$\\{${token}([^}]*)}`, 'g')),
      ];
      expect(occurrences.length).toBeGreaterThan(0);
      for (const [, rest] of occurrences) expect(rest.startsWith(':?')).toBe(true);
    }
  });

  it('never writes a token value into the compose file', () => {
    const assignments = [...COMPOSE.matchAll(/^\s*([A-Z_]*(?:TOKEN|PASSWORD)):\s*(.+)$/gm)];
    expect(assignments.length).toBeGreaterThan(0);
    for (const [, name, value] of assignments) {
      expect({ name, value: value.trim() }).toMatchObject({
        value: expect.stringMatching(/^\$\{/),
      });
    }
  });
});
