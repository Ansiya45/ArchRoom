import { z } from 'zod';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { createRecordingFolder, listRecordingFolders, validateRecordingDestination } from '../services/recording-folder-access.service.js';
import { setRecordingFolderCreatorGrant } from '../services/drive-security.service.js';
import { env } from '../env.js';
import { BatchStudentEnrollmentService } from '../services/batch-student-enrollment.service.js';

const enrollments = new BatchStudentEnrollmentService(env.GOOGLE_INTEGRATION_ADMIN_USER_ID);
const batchId = z.string().regex(/^[A-Za-z0-9_-]{10,128}$/);

export const recordingFoldersRouter = t.router({
  listStudents: protectedProcedure.input(z.object({ folderId: batchId }).strict())
    .query(({ ctx, input }) => enrollments.list(input.folderId, ctx.user!.id)),
  addStudent: protectedProcedure.input(z.object({ folderId: batchId, name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(255) }).strict())
    .mutation(({ ctx, input }) => enrollments.add(input.folderId, input.name, input.email, ctx.user!.id)),
  approveStudent: protectedProcedure.input(z.object({ folderId: batchId, enrollmentId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) => enrollments.transition(input.folderId, input.enrollmentId, 'approve', ctx.user!.id)),
  removeStudent: protectedProcedure.input(z.object({ folderId: batchId, enrollmentId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) => enrollments.transition(input.folderId, input.enrollmentId, 'remove', ctx.user!.id)),
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
