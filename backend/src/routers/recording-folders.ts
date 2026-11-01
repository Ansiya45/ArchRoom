import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { createRecordingFolder, listRecordingFolders, validateRecordingDestination } from '../services/recording-folder-access.service.js';
import { setRecordingFolderCreatorGrant } from '../services/drive-security.service.js';
import { env } from '../env.js';

export const recordingFoldersRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => listRecordingFolders(ctx.user!.id)),
  refresh: protectedProcedure.mutation(({ ctx }) => listRecordingFolders(ctx.user!.id)),
  create: protectedProcedure.input(z.object({ name: z.string().max(255) }))
    .mutation(({ ctx, input }) => createRecordingFolder(ctx.user!.id, input.name)),
  setCreatorGrant: protectedProcedure.input(z.object({ userId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setRecordingFolderCreatorGrant(env.GOOGLE_INTEGRATION_ADMIN_USER_ID, ctx.user!.id, input.userId, input.enabled);
      return { ok: true };
    }),
  validateDestination: protectedProcedure.input(z.object({ folderId: z.string().min(1).max(128).nullable() }))
    .mutation(async ({ ctx, input }) => ({ folderId: await validateRecordingDestination(ctx.user!.id, input.folderId) })),
});
