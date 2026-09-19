import { useEffect, useEffectEvent, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { endsTheSession, isApiError, type ApiError } from '../services/api-error';

export interface Resource<T> {
  /** loading: nothing to show yet. ready: data is shown. error: the last attempt failed. */
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: ApiError | null;
  /** Data is on screen and a newer request is on its way. */
  refreshing: boolean;
  /** A request for the current key is outstanding. */
  inFlight: boolean;
  updatedAt: Date | null;
}

interface Settled<T> {
  data: T | null;
  error: ApiError | null;
  settledFor: string | null;
  updatedAt: Date | null;
}

/**
 * One piece of remote data, loaded for a key and reloaded on demand.
 *
 * A new key or refresh token cancels the request still running for the old
 * one, so requests never overlap and an old answer can never overwrite a new
 * one. While a refresh runs, the previous data stays on screen (dimmed by the
 * caller) instead of flashing back to a skeleton. A 401 or 403 ends the
 * operator's session; a cancelled request changes nothing.
 */
export function useResource<T>(
  key: string,
  refreshToken: number,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const { signOut } = useAuth();
  const requestId = `${key}#${refreshToken}`;
  const [settled, setSettled] = useState<Settled<T>>({
    data: null,
    error: null,
    settledFor: null,
    updatedAt: null,
  });

  const run = useEffectEvent((signal: AbortSignal) => load(signal));
  const endSession = useEffectEvent((error: ApiError) =>
    signOut(error.kind === 'forbidden' ? 'forbidden' : 'expired'),
  );

  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setSettled({ data, error: null, settledFor: requestId, updatedAt: new Date() });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (!isApiError(error)) throw error;
        if (endsTheSession(error)) endSession(error);
        setSettled((previous) => ({ ...previous, data: null, error, settledFor: requestId }));
      },
    );
    return () => controller.abort();
  }, [requestId]);

  const inFlight = settled.settledFor !== requestId;
  // A retry after a failure keeps the error on screen until it succeeds,
  // rather than flashing a skeleton between two identical error messages.
  const status: Resource<T>['status'] =
    settled.data !== null ? 'ready' : settled.error !== null ? 'error' : 'loading';

  return {
    status,
    data: settled.data,
    error: settled.error,
    refreshing: inFlight && status !== 'loading',
    inFlight,
    updatedAt: settled.updatedAt,
  };
}
