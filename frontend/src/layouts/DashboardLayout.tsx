import type { ReactNode } from 'react';

/** Header across the top, content in a centred column, a quiet footer. */
export function DashboardLayout({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to the statistics
      </a>
      {header}
      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-2 px-4 py-3 text-[11px] text-ink-3 sm:px-6">
          <p>
            All times are UTC. Figures are computed by the services and shown as they report them.
          </p>
          <p>Solar Grid operator console</p>
        </div>
      </footer>
    </div>
  );
}
