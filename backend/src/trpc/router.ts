import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createContext, type Context } from './context.js';
import { authRouter } from '../routers/auth.js';
import { meetingsRouter } from '../routers/meetings.js';
import { recordingsRouter } from '../routers/recordings.js';

const t = initTRPC.context<Context>().create();

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
