import { createContext, useContext, type ReactNode } from 'react';
import type { DashboardConfig } from '../config/config';
import type { SolarGridApi } from './solar-grid-api';

export interface Services {
  api: SolarGridApi;
  config: DashboardConfig;
}

const ServicesContext = createContext<Services | null>(null);

/** Hands the API and configuration down, so tests can hand down fakes instead. */
export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('useServices is used outside ServicesProvider.');
  return value;
}
