import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CloseIcon, QuestionIcon } from './icons';
import { cx } from './primitives';

/**
 * A "?" next to a term that needs one sentence of explanation. Opens on
 * hover, focus or click, closes on Escape or when focus leaves; the text is
 * linked to the button so screen readers announce it too. It opens towards
 * whichever side of the screen has room, so it never pushes the page sideways.
 */
export function Help({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setAlignRight(rect.left > window.innerWidth / 2);
  }, [open]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={button}
        type="button"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:text-ink-2"
      >
        <QuestionIcon width={14} height={14} />
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cx(
            'absolute top-full z-40 mt-1.5 w-64 max-w-[80vw] rounded-md border border-line bg-raised px-3 py-2 text-left text-[13px] leading-snug font-normal tracking-normal text-ink-2 normal-case shadow-lg shadow-black/40',
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** The top of every page: what it is, the question it answers, and the period. */
export function PageHeader({
  title,
  question,
  aside,
}: {
  title: string;
  question: string;
  aside?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Moving to a page moves focus to its heading, so a screen reader announces
  // where the operator now is and keyboard users start from the top.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-ink outline-none"
        >
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-2">{question}</p>
      </div>
      {aside}
    </div>
  );
}

/** A named part of a page. The heading carries the hierarchy; the content decides its own frame. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('min-w-0 space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[13px] text-ink-3">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A framed block of content without a heading of its own. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5', className)}>
      {children}
    </div>
  );
}

/**
 * One headline figure: a label with an optional explanation, the value large
 * enough to read across a room, its unit, and a line saying what it covers.
 */
export function BigStat({
  label,
  help,
  value,
  unit,
  caption,
  accent,
  size = 'large',
}: {
  label: string;
  help?: ReactNode;
  value: ReactNode;
  unit?: string;
  caption?: ReactNode;
  /** A colour key tying the figure to its series in the charts. */
  accent?: string;
  size?: 'large' | 'medium';
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        {accent ? (
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: accent }}
          />
        ) : null}
        {label}
        {help ? <Help term={label}>{help}</Help> : null}
      </p>
      <p
        className={cx(
          'mt-1.5 font-semibold leading-none tracking-tight break-words text-ink',
          size === 'large' ? 'text-[34px]' : 'text-2xl',
        )}
      >
        {value}
        {unit ? (
          <span
            className={cx(
              'ml-1.5 font-medium text-ink-3',
              size === 'large' ? 'text-base' : 'text-sm',
            )}
          >
            {unit}
          </span>
        ) : null}
      </p>
      {caption ? <p className="mt-2 text-[13px] leading-snug text-ink-3">{caption}</p> : null}
    </div>
  );
}

/** A small labelled figure inside a group. */
export function Figure({
  label,
  help,
  value,
  unit,
  note,
}: {
  label: string;
  help?: ReactNode;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[13px] text-ink-3">
        {label}
        {help ? <Help term={label}>{help}</Help> : null}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold break-words text-ink">
        {value}
        {unit ? <span className="ml-1 text-[13px] font-normal text-ink-3">{unit}</span> : null}
      </dd>
      {note ? <dd className="text-xs text-ink-3">{note}</dd> : null}
    </div>
  );
}

/**
 * A side panel over the page, for detail on one thing. It takes focus when it
 * opens, keeps Tab inside itself, closes on Escape or the close button, and
 * gives focus back to whatever opened it.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = [
      ...panel.current.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hasAttribute('disabled'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close the details"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-canvas shadow-2xl"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-line bg-canvas px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold break-all text-ink">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
          </div>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-6 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Parts of a whole as one bar, each part labelled in text beside it. For
 * proportions of things that are counted or measured the same way.
 */
export function SplitBar({
  label,
  parts,
}: {
  /** Read out as the bar's description. */
  label: string;
  parts: Array<{ label: string; value: number; color: string; faded?: boolean }>;
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-3 w-full gap-0.5 overflow-hidden rounded-sm bg-raised"
    >
      {total > 0
        ? parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <span
                key={part.label}
                style={{
                  width: `${(part.value / total) * 100}%`,
                  background: part.color,
                  opacity: part.faded ? 0.35 : 1,
                }}
              />
            ))
        : null}
    </div>
  );
}
