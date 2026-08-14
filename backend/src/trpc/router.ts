import { z } from 'zod';
import { createContext } from './context.js';
import { t } from './init.js';
import { authRouter } from '../routers/auth.js';
import { meetingsRouter } from '../routers/meetings.js';
import { recordingsRouter } from '../routers/recordings.js';

export const appRouter = t.router({
  auth: authRouter,
  meetings: meetingsRouter,
  recordings: recordingsRouter,
  health: t.procedure
    .input(z.object({}).optional())
    .query(() => ({
      ok: true,
      stack: 'node-trpc-drizzle-supabase-foundation',
    })),
});

export type AppRouter = typeof appRouter;

export { createContext };
