import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '../env.js';
import { googleDriveOAuth } from '../services/google-drive-integration.runtime.js';
import { assertIntegrationAdministrator } from '../services/drive-security.service.js';
import { getBearerToken, verifyJwt } from '../utils/jwt.js';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';

function configuredService() {
  try { return googleDriveOAuth(); }
  catch { throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google Drive integration is not configured.' }); }
}

export const googleDriveIntegrationRouter = t.router({
  status: protectedProcedure.query(async ({ ctx }) => {
    ctx.res?.setHeader('Cache-Control', 'no-store');
    if (!env.GOOGLE_INTEGRATION_ADMIN_USER_ID || ctx.user!.id !== env.GOOGLE_INTEGRATION_ADMIN_USER_ID)
      return { isAdministrator: false, connected: false, pending: false, connectionState: 'not_connected' as const, accountEmail: null };
    try {
      return { isAdministrator: true, ...await configuredService().status(ctx.user!.id) };
    } catch {
      return { isAdministrator: true, connected: false, pending: false, connectionState: 'status_unavailable' as const, accountEmail: null };
    }
  }),
  start: protectedProcedure.mutation(({ ctx }) => {
    assertIntegrationAdministrator(ctx.user!.id, env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
    const bearer = getBearerToken(ctx.req.headers.authorization);
    let sessionId: string | undefined;
    try { if (bearer) sessionId = verifyJwt(bearer).sid; } catch { /* Context already checked authentication. */ }
    if (!sessionId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'A current administrator session is required.' });
    configuredService();
    const callback = new URL(env.GOOGLE_OAUTH_CALLBACK_URL!);
    ctx.res.setHeader('Cache-Control', 'no-store');
    return { startUrl: new URL('/google-drive/oauth/start', callback.origin).toString() };
  }),
  // The temporary access token is only for the explicitly authorized admin's
  // Google Picker. It is never available to ordinary app users.
  pickerAccess: protectedProcedure.mutation(async ({ ctx }) => {
    assertIntegrationAdministrator(ctx.user!.id, env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
    ctx.res.setHeader('Cache-Control', 'no-store');
    return configuredService().pickerAccess(ctx.user!.id);
  }),
  verifyRoot: protectedProcedure.input(z.object({ selectedFolderId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    assertIntegrationAdministrator(ctx.user!.id, env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
    await configuredService().verifySelectedRoot(ctx.user!.id, input.selectedFolderId);
    return { verified: true };
  }),
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    assertIntegrationAdministrator(ctx.user!.id, env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
    await configuredService().disconnect(ctx.user!.id);
    return { ok: true };
  }),
});
