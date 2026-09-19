import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './auth/auth-context';
import type { TokenStore } from './auth/token-store';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { ServicesProvider, type Services } from './services/services-context';

// The charts are most of the JavaScript; the sign-in page does not wait for them.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);

/** Signed in: the dashboard. Otherwise: the sign-in page. Nothing in between. */
function Gate() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <LoginPage />;
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-sm text-ink-3">
          Loading the dashboard…
        </p>
      }
    >
      <DashboardPage />
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
