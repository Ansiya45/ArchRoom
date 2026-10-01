import { observable } from '@trpc/server/observable';
import { getRefreshToken } from './auth';
import { createTRPCClient, httpBatchLink, type TRPCLink } from '@trpc/client';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { getValidAccessToken } from './sessionRenewal';

const TRPC_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// A server-expired token can differ from the browser's clock. Retry only the
// rejected operation, never an entire batch containing successful mutations.
const renewRejectedSession: TRPCLink<AppRouter> = () => ({ op, next }) => observable(observer => {
  let stopped = false;
  let subscription: { unsubscribe(): void } | undefined;
  const attempt = (retried: boolean) => {
    subscription = next(op).subscribe({
      next: value => observer.next(value),
      complete: () => observer.complete(),
      error: error => {
        if (!retried && error.data?.code === 'UNAUTHORIZED' && getRefreshToken()
          && (!op.path.startsWith('auth.') || op.path === 'auth.me')) {
          void getValidAccessToken(true).then(token => {
            if (stopped) return;
            if (token) attempt(true);
            else observer.error(error);
          }).catch(refreshError => { if (!stopped) observer.error(refreshError); });
        } else observer.error(error);
      },
    });
  };
  attempt(false);
  return () => { stopped = true; subscription?.unsubscribe(); };
});

export const trpc = createTRPCClient<AppRouter>({
  links: [
    renewRejectedSession,
    httpBatchLink({
      url: TRPC_URL,
      async headers() {
        const token = await getValidAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
