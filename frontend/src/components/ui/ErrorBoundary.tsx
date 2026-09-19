import { Component, type ReactNode } from 'react';
import { ErrorIcon } from './icons';

/**
 * The last line of defence: if rendering throws, the operator sees a plain
 * message and a way back, not a blank page - and not the error itself, which
 * is for the browser's developer tools. Failed requests never end up here;
 * each panel shows those itself.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div role="alert" className="max-w-md rounded-lg border border-line bg-surface p-6">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <ErrorIcon className="text-critical" />
            The dashboard hit a problem it could not recover from.
          </p>
          <p className="mt-2 text-sm text-ink-2">
            Reloading the page usually clears it. Your sign-in is kept for this tab.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-[#4b94ea]"
          >
            Reload
          </button>
        </div>
      </main>
    );
  }
}
