import { TRPCError } from '@trpc/server';
import { t } from './init.js';

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});
