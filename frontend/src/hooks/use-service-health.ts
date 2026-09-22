import { SERVICE_NAMES, type ServiceName } from '../config/config';
import type { ReadinessResult } from '../services/solar-grid-api';
import { useServices } from '../services/services-context';
import { useResource, type Resource } from './use-resource';

export { healthState, type HealthState } from '../utils/system-status';

export type ServiceHealth = Record<ServiceName, ReadinessResult & { checkedAt: Date }>;

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
