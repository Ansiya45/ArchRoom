import { z } from 'zod';
import { createContext } from './context.js';
import { t } from './init.js';
import { authRouter } from '../routers/auth.js';
import { meetingsRouter } from '../routers/meetings.js';
import { recordingsRouter } from '../routers/recordings.js';
import { chatAttachmentsRouter } from '../routers/chat-attachments.js';
import { googleDriveIntegrationRouter } from '../routers/google-drive-integration.js';
import { recordingFoldersRouter } from '../routers/recording-folders.js';
import { batchRegistrationRouter } from '../routers/batch-registration.js';
import { studentGoogleIdentityRouter } from '../routers/student-google-identity.js';

import { meetingNotificationsRouter } from '../routers/meeting-notifications.js';

export const appRouter = t.router({
  auth: authRouter,
  meetings: meetingsRouter,
  meetingNotifications: meetingNotificationsRouter,
  recordings: recordingsRouter,
  chatAttachments: chatAttachmentsRouter,
  googleDriveIntegration: googleDriveIntegrationRouter,
  recordingFolders: recordingFoldersRouter,
  batchRegistration: batchRegistrationRouter,
  studentGoogleIdentity: studentGoogleIdentityRouter,
  health: t.procedure
    .input(z.object({}).optional())
    .query(() => ({
      ok: true,
      stack: 'node-trpc-drizzle-supabase-foundation',
    })),
});

export type AppRouter = typeof appRouter;

export { createContext };
