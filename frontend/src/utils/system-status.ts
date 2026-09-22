import { SERVICE_NAMES, type ServiceName } from '../config/config';
import type { ServiceHealth } from '../hooks/use-service-health';
import type { ReadinessResult } from '../services/solar-grid-api';

export type HealthState = 'ready' | 'degraded' | 'unreachable';

/**
 * One service: ready; up but not ready (a dependency is down, or it is
 * shutting down); or no answer at all.
 */
export function healthState(result: ReadinessResult): HealthState {
  if (result.report?.status === 'ready') return 'ready';
  if (result.report) return 'degraded';
  return 'unreachable';
}

export type SystemState = 'checking' | 'operational' | 'degraded' | 'down';

export interface SystemStatus {
  state: SystemState;
  ready: number;
  total: number;
  /** Services that are not ready, in the order the dashboard lists them. */
  affected: ServiceName[];
}

/**
 * The grid as a whole: operational when every service is ready, down when
 * none is, degraded in between. Based only on what the services report
 * about themselves.
 */
export function systemStatus(health: ServiceHealth | null): SystemStatus {
  if (!health) return { state: 'checking', ready: 0, total: SERVICE_NAMES.length, affected: [] };
  const affected = SERVICE_NAMES.filter((service) => healthState(health[service]) !== 'ready');
  const ready = SERVICE_NAMES.length - affected.length;
  const state: SystemState =
    affected.length === 0 ? 'operational' : ready === 0 ? 'down' : 'degraded';
  return { state, ready, total: SERVICE_NAMES.length, affected };
}

/** Dependencies as an operator would say them. */
export const DEPENDENCY_NAMES: Record<string, string> = {
  database: 'its database',
  rabbitmq: 'the message broker',
};

/** Which of a service's dependencies its last readiness answer reported down. */
export function downDependencies(result: ReadinessResult): string[] {
  return Object.entries(result.report?.checks ?? {})
    .filter(([, check]) => check.status === 'down')
    .map(([name]) => name);
}
