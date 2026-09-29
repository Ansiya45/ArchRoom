export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

const TOKEN_KEY = 'ylaam_meet_token';
const USER_KEY = 'ylaam_meet_user';
const SESSION_REMOVED = 'ylaam-session-removed';

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (!getAuthToken()) return null;
  const stored = window.localStorage.getItem(USER_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as SessionUser;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function storeSession(token: string, user: SessionUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(SESSION_REMOVED));
}

// Native storage events reach other tabs; the custom event reaches this tab.
export function subscribeToSessionRemoval(onRemoved: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== null && event.key !== TOKEN_KEY && event.key !== USER_KEY) return;
    if (!getAuthToken() || !window.localStorage.getItem(USER_KEY)) onRemoved();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SESSION_REMOVED, onRemoved);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SESSION_REMOVED, onRemoved);
  };
}
