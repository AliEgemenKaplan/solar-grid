import { SERVICE_NAMES, type ServiceName } from '../config/config';
import type { ReadinessResult } from '../services/solar-grid-api';
import { useServices } from '../services/services-context';
import { useResource, type Resource } from './use-resource';

export type ServiceHealth = Record<ServiceName, ReadinessResult & { checkedAt: Date }>;

export type HealthState = 'ready' | 'degraded' | 'unreachable';

/** Ready, up but not ready, or no answer at all. */
export function healthState(result: ReadinessResult): HealthState {
  if (result.report?.status === 'ready') return 'ready';
  if (result.report) return 'degraded';
  return 'unreachable';
}

/**
 * Readiness of all four services, from their public /health/ready. Only the
 * status and the names of the dependencies are read; the endpoint carries no
 * error text or addresses, and nothing else is asked for.
 */
export function useServiceHealth(refreshToken: number): Resource<ServiceHealth> {
  const { api } = useServices();
  return useResource('health', refreshToken, async (signal) => {
    const results = await Promise.all(
      SERVICE_NAMES.map(
        async (service) => [service, await api.readiness(service, signal)] as const,
      ),
    );
    const checkedAt = new Date();
    return Object.fromEntries(
      results.map(([service, result]) => [service, { ...result, checkedAt }]),
    ) as ServiceHealth;
  });
}
