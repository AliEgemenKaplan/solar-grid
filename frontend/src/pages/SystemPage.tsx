import { useDashboard } from '../app/dashboard-context';
import { AttentionPanel, SystemStatusBanner } from '../components/status/SystemStatus';
import {
  EngineeringDiagnostics,
  EventPipeline,
  OperationsCounters,
  ServiceCards,
} from '../components/system/SystemViews';
import { Section } from '../components/ui/layout';

/**
 * Whether every service is working, what each one depends on, and what they
 * have been doing: the events flowing between them and the work they did.
 * Everything here comes from the services' public readiness checks and their
 * operator-only counters; nothing from the message broker or the databases
 * is exposed to the browser.
 */
export function SystemPage() {
  const { health, diagnostics, issues, navigate } = useDashboard();
  return (
    <>
      <SystemStatusBanner health={health} />
      <AttentionPanel issues={issues} checking={!health.data} onOpen={navigate} here="system" />

      <Section
        title="Services"
        description="Each service answers for itself: whether it is ready, how fast it answered, and whether it can reach what it depends on."
      >
        <ServiceCards health={health} />
      </Section>

      <Section
        title="Messages and events"
        description="How a meter reading travels from the smart meter service, through the message broker, to trade matching."
      >
        <EventPipeline diagnostics={diagnostics} />
      </Section>

      <Section
        title="Operations"
        description="The work the services have done since they last started."
      >
        <OperationsCounters diagnostics={diagnostics} />
      </Section>

      <details className="group rounded-lg border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[15px] font-semibold text-ink">
              Engineering diagnostics
            </span>
            <span className="block text-[13px] text-ink-3">
              Requests, response times and dependency failures per service, for engineers.
            </span>
          </span>
          <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="border-t border-line px-5 py-4">
          <EngineeringDiagnostics diagnostics={diagnostics} />
        </div>
      </details>

      <Section
        title="Not shown here"
        description="What this dashboard deliberately does not expose, and why."
      >
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>
            The message broker’s queue depths and its management interface: they need broker
            administrator credentials, which never reach the browser. The event counts above come
            from the services themselves.
          </li>
          <li>
            The contents of the dead-letter queue: set-aside events are counted here, but reading
            them needs access to the message broker itself.
          </li>
          <li>
            Database details, internal addresses and error messages from inside the services: a
            health check reports only whether each dependency is up.
          </li>
          <li>
            Counts before a service last restarted: every counter starts again from zero, and each
            section says since when it has been counting.
          </li>
        </ul>
      </Section>
    </>
  );
}
