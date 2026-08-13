import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { type Context } from '../trpc/context.js';
import { AuthService } from '../services/auth.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const t = initTRPC.context<Context>().create();
const authService = new AuthService();

export const authRouter = t.router({
  signup: t.procedure
    .input(
      z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ input }) => {
      return authService.signup(input);
    }),

  login: t.procedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ input }) => {
      return authService.login(input);
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    return authService.me(ctx.user!.id);
  }),
});
