import { SERVICE_NAMES } from '../config/config';
import { endsTheSession, isApiError } from '../services/api-error';
import { useServices } from '../services/services-context';
import type { ServiceDiagnostics } from '../utils/diagnostics';
import { useResource, type Resource } from './use-resource';

/**
 * Every service's own counters, for the system view and the attention list.
 * One service that cannot answer does not hide the others; a refused token
 * still ends the session, as it does everywhere else.
 */
export function useDiagnostics(refreshToken: number): Resource<ServiceDiagnostics> {
  const { api } = useServices();
  return useResource('diagnostics', refreshToken, async (signal) => {
    const results = await Promise.all(
      SERVICE_NAMES.map(async (service) => {
        try {
          return [
            service,
            { snapshot: (await api.diagnostics(service, signal)).data, error: null },
          ] as const;
        } catch (error) {
          if (!isApiError(error) || endsTheSession(error) || error.kind === 'aborted') throw error;
          return [service, { snapshot: null, error }] as const;
        }
      }),
    );
    return Object.fromEntries(results) as ServiceDiagnostics;
  });
}
