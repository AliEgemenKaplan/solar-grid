import { useState, type ReactNode } from 'react';
import { useDashboard } from '../../app/dashboard-context';
import { HouseholdDetail } from './HouseholdDetail';

/**
 * The household detail panel for any page that lists households: `open`
 * shows one, and `drawer` is what to render (nothing while closed).
 */
export function useHouseholdDetail(): { open: (householdId: string) => void; drawer: ReactNode } {
  const { timeWindow, period, refreshToken } = useDashboard();
  const [selected, setSelected] = useState<string | null>(null);
  const drawer = selected ? (
    <HouseholdDetail
      householdId={selected}
      timeWindow={timeWindow}
      period={period}
      refreshToken={refreshToken}
      onClose={() => setSelected(null)}
    />
  ) : null;
  return { open: setSelected, drawer };
}
