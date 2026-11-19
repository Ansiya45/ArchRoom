import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { client } from '../db/index.js';
import { env } from '../env.js';
import { StudentGoogleOidcService } from '../services/student-google-oidc.service.js';

const service = new StudentGoogleOidcService(client, { clientId: env.STUDENT_GOOGLE_CLIENT_ID,
  clientSecret: env.STUDENT_GOOGLE_CLIENT_SECRET, callbackUrl: env.STUDENT_GOOGLE_OAUTH_CALLBACK_URL,
  companyClientId: env.GOOGLE_CLIENT_ID });
const owner = (user: { id: string; sessionId?: string }) => {
  if (!user.sessionId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in again to manage your Google identity.' });
  return { userId: user.id, sessionId: user.sessionId };
};
export const studentGoogleIdentityRouter = t.router({
  status: protectedProcedure.query(({ ctx }) => { ctx.res?.setHeader('Cache-Control', 'no-store'); return service.status(owner(ctx.user)); }),
  connect: protectedProcedure.mutation(({ ctx }) => { ctx.res?.setHeader('Cache-Control', 'no-store'); return service.start(owner(ctx.user)); }),
  callback: protectedProcedure.input(z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096) }).strict())
    .mutation(({ ctx, input }) => { ctx.res?.setHeader('Cache-Control', 'no-store'); return service.complete(owner(ctx.user), input.state, input.code); }),
  unlink: protectedProcedure.mutation(({ ctx }) => { ctx.res?.setHeader('Cache-Control', 'no-store'); return service.unlink(owner(ctx.user)); }),
});
