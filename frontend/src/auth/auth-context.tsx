import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ServiceName } from '../config/config';
import { isApiError } from '../services/api-error';
import type { SolarGridApi } from '../services/solar-grid-api';
import type { TokenStore } from './token-store';

/** Why the operator is looking at the sign-in form. */
export type SignOutReason = 'signed-out' | 'expired' | 'forbidden';

export type SignInResult = { ok: true } | { ok: false; message: string };

interface AuthContextValue {
  isSignedIn: boolean;
  /** Set when the operator was signed out rather than never signed in. */
  notice: SignOutReason | null;
  signIn(token: string): Promise<SignInResult>;
  signOut(reason?: SignOutReason): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The services a new token is checked against, in order. The first one that
 * gives a definite answer - accepted, refused, or the wrong role - decides; a
 * service that cannot be reached passes the question on to the next, so
 * signing in does not depend on any single service being up.
 */
const VERIFY_WITH: readonly ServiceName[] = ['tradeMatching', 'billing', 'smartMeter', 'pricing'];

/**
 * Operator sign-in against the real backend.
 *
 * There is no user database and no session here: the services check the
 * bearer token on every request, and this provider only asks one of them
 * whether a token is an operator token before keeping it for the tab. Any
 * later 401 or 403 ends the session, so a token that is rotated on the server
 * stops working in the dashboard too.
 */
export function AuthProvider({
  api,
  tokens,
  now = () => new Date(),
  children,
}: {
  api: Pick<SolarGridApi, 'verifyOperatorToken'>;
  tokens: TokenStore;
  now?: () => Date;
  children: ReactNode;
}) {
  const token = useSyncExternalStore(tokens.subscribe, tokens.get, tokens.get);
  const [notice, setNotice] = useState<SignOutReason | null>(null);

  const signIn = useCallback(
    async (candidate: string): Promise<SignInResult> => {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) return { ok: false, message: 'Enter the operator token.' };

      for (const service of VERIFY_WITH) {
        try {
          await api.verifyOperatorToken(service, trimmed, now());
          tokens.set(trimmed);
          setNotice(null);
          return { ok: true };
        } catch (error) {
          if (!isApiError(error)) throw error;
          if (error.kind === 'unauthorized') {
            return { ok: false, message: 'That token was not accepted. Check it and try again.' };
          }
          if (error.kind === 'forbidden') {
            return {
              ok: false,
              message: 'That token belongs to another role. Sign in with the operator token.',
            };
          }
          // Unreachable, timed out or unavailable: ask the next service.
        }
      }
      return {
        ok: false,
        message:
          'No Solar Grid service could be reached to check the token. Check that the stack is running.',
      };
    },
    [api, now, tokens],
  );

  const signOut = useCallback(
    (reason: SignOutReason = 'signed-out') => {
      tokens.clear();
      setNotice(reason);
    },
    [tokens],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ isSignedIn: token !== null, notice, signIn, signOut }),
    [token, notice, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth is used outside AuthProvider.');
  return value;
}

export const SIGN_OUT_MESSAGES: Record<SignOutReason, string> = {
  'signed-out': 'You have signed out. The token has been removed from this tab.',
  expired: 'The operator token is no longer accepted. Sign in again.',
  forbidden:
    'That token is not allowed to read operator statistics. Sign in with the operator token.',
};
