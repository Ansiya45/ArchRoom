import { z } from 'zod';
import { t } from '../trpc/init.js';
import { ChatAttachmentService } from '../services/chat-attachment.service.js';

const service = new ChatAttachmentService();

export const chatAttachmentsRouter = t.router({
  createUpload: t.procedure.input(z.object({
    meetingCode: z.string().min(1),
    participantId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(25 * 1024 * 1024),
  })).mutation(({ input, ctx }) => service.createUpload(input.meetingCode, input.fileName, {
    userId: ctx.user?.id,
    participantId: input.participantId,
  })),
  downloadUrl: t.procedure.input(z.object({
    meetingCode: z.string().min(1),
    participantId: z.string().uuid().optional(),
    storagePath: z.string().min(1).max(500),
    fileName: z.string().min(1).max(255),
  })).mutation(({ input, ctx }) => service.downloadUrl(input.meetingCode, input.storagePath, input.fileName, {
    userId: ctx.user?.id,
    participantId: input.participantId,
  })),
});
