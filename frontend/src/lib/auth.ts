export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

const TOKEN_KEY = 'ylaam_meet_token';
const USER_KEY = 'ylaam_meet_user';

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
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
}
