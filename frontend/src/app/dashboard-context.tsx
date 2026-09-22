import { createContext, useContext, type ReactNode } from 'react';
import type { DashboardData } from '../hooks/use-dashboard-data';
import type { Resource } from '../hooks/use-resource';
import type { ServiceHealth } from '../hooks/use-service-health';
import type { Issue } from '../utils/attention';
import type { ServiceDiagnostics } from '../utils/diagnostics';
import type { TimeWindow } from '../utils/time-range';
import type { PageId } from './routes';

/**
 * Everything the pages read, loaded once by the control center and shared,
 * so moving between pages never fetches again and every page shows the same
 * moment for the same period.
 */
export interface DashboardContextValue {
  timeWindow: TimeWindow;
  /** "Last 24 hours": what every period figure covers. */
  period: string;
  /** The period selector, for a page that places it itself. */
  periodControl: ReactNode;
  data: DashboardData;
  health: Resource<ServiceHealth>;
  diagnostics: Resource<ServiceDiagnostics>;
  issues: Issue[];
  refreshToken: number;
  navigate: (page: PageId) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardContextValue;
  children: ReactNode;
}) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) throw new Error('useDashboard is used outside the control center.');
  return value;
}
