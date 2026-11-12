import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { env } from '../env.js';
import { BatchRegistrationService } from '../services/batch-registration.service.js';
import { studentGoogleIdentityStatus } from '../services/student-google-identity.service.js';

const service = new BatchRegistrationService(env.GOOGLE_INTEGRATION_ADMIN_USER_ID, env.APP_PUBLIC_URL, env.JWT_SECRET);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const folder = z.object({ folderId: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/) }).strict();
const publicProcedure = t.procedure.use(({ ctx, next }) => {
  ctx.res?.setHeader('Cache-Control', 'no-store'); return next();
});
export const batchRegistrationRouter = t.router({
  linkStatus: protectedProcedure.input(folder).query(({ ctx, input }) => service.linkStatus(input.folderId, ctx.user!.id)),
  generateLink: protectedProcedure.input(folder.extend({ expiresInDays: z.number().int().min(1).max(30).default(7) }).strict())
    .mutation(({ ctx, input }) => { ctx.res?.setHeader('Cache-Control', 'no-store'); return service.generate(input.folderId, ctx.user!.id, input.expiresInDays); }),
  disableLink: protectedProcedure.input(folder).mutation(({ ctx, input }) => service.disable(input.folderId, ctx.user!.id)),
  identify: publicProcedure.input(z.object({ token }).strict()).mutation(({ ctx, input }) => service.identify(input.token, ctx.req.socket.remoteAddress ?? 'unknown')),
  register: publicProcedure.input(z.object({ token, name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(255) }).strict())
    .mutation(({ ctx, input }) => service.register(input.token, input.name, input.email, ctx.req.socket.remoteAddress ?? 'unknown')),
  verify: publicProcedure.input(z.object({ token }).strict()).mutation(({ ctx, input }) => service.verify(input.token, ctx.req.socket.remoteAddress ?? 'unknown')),
  verifyAndBind: protectedProcedure.input(z.object({ token }).strict()).mutation(({ ctx, input }) => {
    ctx.res?.setHeader('Cache-Control', 'no-store');
    return service.verifyAndBind(input.token, ctx.user!.id, ctx.req.socket.remoteAddress ?? 'unknown');
  }),
  googleIdentityStatus: protectedProcedure.input(z.object({}).strict().optional()).query(({ ctx }) => studentGoogleIdentityStatus(ctx.user!.id)),
});
