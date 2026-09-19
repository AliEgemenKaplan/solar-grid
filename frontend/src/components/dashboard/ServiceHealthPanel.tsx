import { SERVICE_LABELS, SERVICE_NAMES } from '../../config/config';
import type { Resource } from '../../hooks/use-resource';
import { healthState, type ServiceHealth } from '../../hooks/use-service-health';
import { formatLatency, formatTime } from '../../utils/format';
import { LoadingBlock, Panel, StatusBadge, type Tone } from '../ui/primitives';

const STATE_TONE: Record<ReturnType<typeof healthState>, Tone> = {
  ready: 'good',
  degraded: 'warning',
  unreachable: 'critical',
};

const STATE_LABEL: Record<ReturnType<typeof healthState>, string> = {
  ready: 'Ready',
  degraded: 'Not ready',
  unreachable: 'Unreachable',
};

/** A dependency's name as an operator would say it. */
const DEPENDENCY_LABELS: Record<string, string> = {
  database: 'Database',
  rabbitmq: 'Message broker',
};

/**
 * Each service's own readiness answer: whether it can do its work, and which
 * of its dependencies are up. That is all the endpoint says and all this
 * shows - no addresses, no error text.
 */
export function ServiceHealthPanel({ health }: { health: Resource<ServiceHealth> }) {
  const data = health.data;
  return (
    <Panel
      title="Service health"
      subtitle="Readiness reported by each service"
      refreshing={health.refreshing}
      actions={data ? <HealthSummary health={data} /> : null}
    >
      {!data ? (
        <LoadingBlock label="Checking services" lines={4} />
      ) : (
        <div className="overflow-x-auto">
          <table className="figures w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Readiness of each Solar Grid service</caption>
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th scope="col" className="pb-2 font-medium">
                  Service
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Status
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Dependencies
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Response
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Checked
                </th>
              </tr>
            </thead>
            <tbody>
              {SERVICE_NAMES.map((service) => {
                const result = data[service];
                const state = healthState(result);
                const checks = Object.entries(result.report?.checks ?? {});
                return (
                  <tr key={service} className="border-t border-line">
                    <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">
                      {SERVICE_LABELS[service]}
                    </th>
                    <td className="py-2.5 pr-3">
                      <StatusBadge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusBadge>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-ink-2">
                      {checks.length === 0 ? (
                        <span className="text-ink-3">
                          {state === 'unreachable' ? 'No answer' : '—'}
                        </span>
                      ) : (
                        <ul className="flex flex-wrap gap-x-3 gap-y-1">
                          {checks.map(([name, check]) => (
                            <li key={name}>
                              {DEPENDENCY_LABELS[name] ?? name}{' '}
                              <span
                                className={
                                  check.status === 'up' ? 'text-ink-2' : 'font-medium text-serious'
                                }
                              >
                                {check.status === 'up' ? 'up' : 'down'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-ink-2">
                      {formatLatency(result.latencyMs)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-ink-3">
                      {formatTime(result.checkedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** "4 of 4 ready", as a word and an icon. */
export function HealthSummary({ health }: { health: ServiceHealth }) {
  const ready = SERVICE_NAMES.filter((service) => healthState(health[service]) === 'ready').length;
  const tone: Tone = ready === SERVICE_NAMES.length ? 'good' : ready === 0 ? 'critical' : 'warning';
  return (
    <StatusBadge tone={tone}>
      {ready} of {SERVICE_NAMES.length} services ready
    </StatusBadge>
  );
}
