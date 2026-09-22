import { useCallback, useSyncExternalStore } from 'react';
import { hashFor, pageFromHash, type PageId } from '../app/routes';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

const current = () => pageFromHash(window.location.hash);

/**
 * The page in the address bar (`#/energy`). Changing page changes the hash,
 * so back and forward move between pages and a copied link opens the same one.
 */
export function useHashRoute(): [PageId, (page: PageId) => void] {
  const page = useSyncExternalStore(subscribe, current, () => 'overview' as PageId);
  const navigate = useCallback((next: PageId) => {
    if (pageFromHash(window.location.hash) !== next) window.location.hash = hashFor(next);
  }, []);
  return [page, navigate];
}
