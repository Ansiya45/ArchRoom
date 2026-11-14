import { z } from 'zod';
import { t } from '../trpc/init.js';
import { ChatAttachmentService } from '../services/chat-attachment.service.js';
import { requireFeature } from '../services/permission.service.js';
import type { FeatureLevel } from '../services/permission.service.js';

const service = new ChatAttachmentService();

// Guests have no account, so workspace permissions apply only to signed-in users.
async function guardChat(userId: string | undefined, need: FeatureLevel) {
  if (userId) await requireFeature(userId, 'chat', need);
}

export const chatAttachmentsRouter = t.router({
  createUpload: t.procedure.input(z.object({
    meetingCode: z.string().min(1),
    occurrenceId: z.string().uuid().optional(),
    participantId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(25 * 1024 * 1024),
  })).mutation(async ({ input, ctx }) => {
    await guardChat(ctx.user?.id, 'write');
    return service.createUpload(input.meetingCode, input.fileName, {
      userId: ctx.user?.id,
      participantId: input.participantId,
      occurrenceId: input.occurrenceId,
    });
  }),
  downloadUrl: t.procedure.input(z.object({
    meetingCode: z.string().min(1),
    occurrenceId: z.string().uuid().optional(),
    participantId: z.string().uuid().optional(),
    storagePath: z.string().min(1).max(500),
    fileName: z.string().min(1).max(255),
  })).mutation(async ({ input, ctx }) => {
    await guardChat(ctx.user?.id, 'read');
    return service.downloadUrl(input.meetingCode, input.storagePath, input.fileName, {
      userId: ctx.user?.id,
      participantId: input.participantId,
      occurrenceId: input.occurrenceId,
    });
  }),
});
