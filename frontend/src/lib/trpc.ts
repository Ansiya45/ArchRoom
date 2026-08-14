import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { getAuthToken } from './auth';

const TRPC_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001';

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      headers() {
        const token = getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
