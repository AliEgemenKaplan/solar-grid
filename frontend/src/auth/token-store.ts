/**
 * Where the operator token lives while the dashboard is open.
 *
 * Session storage, not local storage: the token survives a reload of this tab
 * and nothing else. Closing the tab, or signing out, removes it; another tab
 * or another browser profile never sees it. Any script running on this page
 * could read it, which is why the page ships a content security policy that
 * allows only its own scripts, and why nothing here ever writes the token
 * anywhere else - not the console, not a URL, not the DOM.
 *
 * A cookie flagged HttpOnly would keep it from scripts entirely, but the
 * services authenticate with a bearer header and have no session endpoint to
 * set one; adding that would be a new authentication system.
 */

const STORAGE_KEY = 'solar-grid.operator-token';

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createTokenStore(storage: Storage | null = sessionStorageOrNull()): TokenStore {
  let token = read(storage);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    get: () => token,
    set(next) {
      token = next;
      write(storage, next);
      notify();
    },
    clear() {
      token = null;
      write(storage, null);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage can be switched off; the dashboard then asks for the token on every load.
    return null;
  }
}

function read(storage: Storage | null): string | null {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, value);
  } catch {
    // Kept in memory for this page only.
  }
}
