import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../../services/api-error';
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * A titled region of the dashboard. The heading names the region for screen
 * readers, and `refreshing` dims the content while newer data is on its way
 * rather than replacing it with a skeleton.
 */
export function Panel({
  title,
  subtitle,
  actions,
  refreshing = false,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  refreshing?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={refreshing || undefined}
      className={cx('min-w-0 rounded-lg border border-line bg-surface', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-[13px] font-semibold tracking-wide text-ink">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cx('p-4 transition-opacity', refreshing && 'opacity-60')}>{children}</div>
    </section>
  );
}

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';

const TONE_STYLES: Record<Tone, string> = {
  good: 'text-good',
  warning: 'text-warning',
  critical: 'text-critical',
  neutral: 'text-ink-3',
};

const TONE_ICONS: Record<Tone, typeof CheckIcon> = {
  good: CheckIcon,
  warning: WarningIcon,
  critical: ErrorIcon,
  neutral: InfoIcon,
};

/** A state, always as an icon and a word: never colour alone. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICONS[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
      <Icon className={TONE_STYLES[tone]} />
      <span>{children}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded bg-raised', className)} />;
}

/** Placeholder rows while a panel loads for the first time. */
export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-4', index % 2 === 0 ? 'w-3/4' : 'w-1/2')} />
      ))}
    </div>
  );
}

/**
 * A panel that could not load. Says which part failed in plain words and gives
 * the reference to look the request up in the service logs; never the raw
 * response.
 */
export function ErrorState({
  title,
  error,
  retrying = false,
}: {
  title: string;
  error: ApiError | null;
  retrying?: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-critical/30 bg-critical/5 px-3 py-3">
      <ErrorIcon className="mt-0.5 shrink-0 text-critical" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">{title}</p>
        {error ? <p className="mt-0.5 text-ink-2">{error.message}</p> : null}
        <p className="mt-1 text-xs text-ink-3">
          {retrying ? 'Trying again…' : 'The dashboard will try again on the next refresh.'}
          {error?.details.correlationId ? (
            <>
              {' '}
              Reference{' '}
              <code className="font-mono break-all text-ink-2">{error.details.correlationId}</code>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** Nothing happened in the window. Not an error, and not styled like one. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-xs text-ink-3">{children}</p> : null}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-[#4b94ea] disabled:bg-accent/40',
  secondary: 'border border-line bg-raised text-ink hover:border-ink-3 disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink disabled:text-ink-3',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
        BUTTON_STYLES[variant],
        className,
      )}
      {...props}
    />
  );
}

/** A label and a value, for small facts inside a panel. */
export function Fact({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink">
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span> : null}
      </dd>
      {hint ? <dd className="mt-0.5 text-xs text-ink-3">{hint}</dd> : null}
    </div>
  );
}
