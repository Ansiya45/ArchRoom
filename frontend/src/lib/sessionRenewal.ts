import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { clearStoredSession, getAuthToken, getRefreshToken, storeSession } from './auth';

// This client deliberately has no access-token/renewal hook.
const sessionClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: import.meta.env.VITE_API_BASE_URL || '/api' })],
});
let pending: { credential: string; promise: Promise<string | null> } | null = null;

function needsRenewal(token: string | null) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + 60_000;
  } catch { return true; }
}

export async function getValidAccessToken(forceRenewal = false): Promise<string | null> {
  const token = getAuthToken();
  const credential = getRefreshToken();
  if (!credential || (!forceRenewal && !needsRenewal(token))) return token;
  if (pending?.credential === credential) return pending.promise;
  const promise = sessionClient.auth.refresh.mutate({ refreshToken: credential }).then(result => {
    // Logout or a different login while renewal was in flight wins.
    if (getRefreshToken() !== credential) return null;
    storeSession(result.token, result.user, credential);
    return result.token;
  }).catch(error => {
    if (getRefreshToken() === credential && error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') {
      clearStoredSession();
    }
    // Network/server errors retain the stored session for the next attempt.
    throw error;
  }).finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { credential, promise };
  return promise;
}

export async function logoutSession() {
  const refreshToken = getRefreshToken();
  clearStoredSession();
  if (refreshToken) await sessionClient.auth.logout.mutate({ refreshToken });
}
