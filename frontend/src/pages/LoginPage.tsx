import { useId, useState, type FormEvent } from 'react';
import { SIGN_OUT_MESSAGES, useAuth } from '../auth/auth-context';
import { SERVICE_LABELS, SERVICE_NAMES } from '../config/config';
import { GridMark, InfoIcon } from '../components/ui/icons';
import { Button, StatusBadge, type Tone } from '../components/ui/primitives';
import { healthState, useServiceHealth } from '../hooks/use-service-health';

const HEALTH_TONE: Record<ReturnType<typeof healthState>, Tone> = {
  ready: 'good',
  degraded: 'warning',
  unreachable: 'critical',
};
const HEALTH_LABEL: Record<ReturnType<typeof healthState>, string> = {
  ready: 'Ready',
  degraded: 'Not ready',
  unreachable: 'Unreachable',
};

/**
 * Operator sign-in. The token is checked by the services themselves; this
 * page never shows it back, never stores it before the check succeeds, and
 * forgets the typed value as soon as the check is done.
 *
 * Service readiness is public, so the page shows it before sign-in: an
 * operator can see that the stack is down without first guessing whether
 * their token is wrong.
 */
export function LoginPage() {
  const { signIn, notice } = useAuth();
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const health = useServiceHealth(0);
  const inputId = useId();
  const hintId = useId();
  const problemId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setProblem(null);
    const result = await signIn(token);
    // On success this page unmounts; on failure the typed value is cleared too.
    setToken('');
    setPending(false);
    if (!result.ok) setProblem(result.message);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <GridMark size={36} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">SolarGrid</h1>
            <p className="text-xs text-ink-3">
              Energy Trading &amp; Distributed Grid · Operator console
            </p>
          </div>
        </div>

        <section
          aria-labelledby={`${inputId}-title`}
          className="rounded-lg border border-line bg-surface p-6"
        >
          <h2 id={`${inputId}-title`} className="text-[15px] font-semibold text-ink">
            Operator sign-in
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Enter the operator token the stack was started with. Each service checks it on every
            request.
          </p>

          {notice ? (
            <p
              role="status"
              className="mt-4 flex gap-2 rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink-2"
            >
              <InfoIcon className="mt-0.5 shrink-0 text-ink-3" />
              {SIGN_OUT_MESSAGES[notice]}
            </p>
          ) : null}

          <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
            <div>
              <label htmlFor={inputId} className="block text-xs font-medium text-ink-2">
                Operator token
              </label>
              <input
                id={inputId}
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoFocus
                required
                aria-invalid={problem !== null}
                aria-describedby={problem ? `${problemId} ${hintId}` : hintId}
                disabled={pending}
                className="mt-1 h-9 w-full rounded-md border border-line bg-canvas px-3 font-mono text-sm text-ink disabled:opacity-60"
              />
              <p id={hintId} className="mt-1.5 text-[11px] text-ink-3">
                Kept in this browser tab only, and removed when you sign out or close the tab.
              </p>
            </div>

            {problem ? (
              <p id={problemId} role="alert" className="text-sm text-serious">
                {problem}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="h-9 w-full"
              // Only while checking: a button disabled for an empty field would
              // also swallow Enter, and say nothing about why.
              disabled={pending}
            >
              {pending ? 'Checking the token…' : 'Sign in'}
            </Button>
          </form>
        </section>

        <section
          aria-label="Service status"
          className="mt-4 rounded-lg border border-line bg-surface px-4 py-3"
        >
          <h2 className="text-xs font-medium text-ink-3">Grid services</h2>
          {health.data ? (
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {SERVICE_NAMES.map((service) => {
                const state = healthState(health.data![service]);
                return (
                  <li key={service} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-2">{SERVICE_LABELS[service]}</span>
                    <StatusBadge tone={HEALTH_TONE[state]}>{HEALTH_LABEL[state]}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p role="status" className="mt-2 text-xs text-ink-3">
              Checking services…
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
