import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './auth/auth-context';
import type { TokenStore } from './auth/token-store';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { ServicesProvider, type Services } from './services/services-context';

// The charts are most of the JavaScript; the sign-in page does not wait for them.
const ControlCenter = lazy(() =>
  import('./app/ControlCenter').then((module) => ({ default: module.ControlCenter })),
);

/** Signed in: the control center. Otherwise: the sign-in page. Nothing in between. */
function Gate() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <LoginPage />;
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-sm text-ink-3">
          Loading the control center…
        </p>
      }
    >
      <ControlCenter />
    </Suspense>
  );
}

export function App({ services, tokens }: { services: Services; tokens: TokenStore }) {
  return (
    <ErrorBoundary>
      <ServicesProvider value={services}>
        <AuthProvider api={services.api} tokens={tokens}>
          <Gate />
        </AuthProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
