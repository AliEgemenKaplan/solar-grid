import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

/**
 * Helpers for taking a dependency away and giving it back.
 *
 * A container is stopped and started, not restarted by Testcontainers, and it
 * keeps a fixed host port, so the service under test reconnects to the same
 * address - the way it would to a database or broker that came back.
 */

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

export function stopContainer(container: { getId(): string }): void {
  execFileSync('docker', ['stop', '--time', '2', container.getId()], { stdio: 'ignore' });
}

export function startContainer(container: { getId(): string }): void {
  execFileSync('docker', ['start', container.getId()], { stdio: 'ignore' });
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch {
      // The dependency may still be coming back; keep asking.
    }
    await wait(250);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}

/** Log lines a StructuredLogger wrote, parsed. */
export function parseLogLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}
