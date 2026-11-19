import { z } from 'zod';
import { env } from '../env.js';
import { CompanyRecordingJobsService } from '../services/company-recording-jobs.service.js';
import { t } from '../trpc/init.js';
import { RecordingService } from '../services/recording.service.js';
import { protectedProcedure } from '../trpc/protected.js';
import { requireFeature } from '../services/permission.service.js';
import { MeetingHistoryService, driveRecordingUrl } from '../services/meeting-history.service.js';
import { companyRecordingUploadOrchestrator, companyRecordingSharingRuntime } from '../services/company-recording-upload-orchestrator.runtime.js';
import { companyRecordingCapability } from '../services/company-recording-capability.service.js';
import { client } from '../db/index.js';
import { CompanyRecordingAnyoneConfirmationService } from '../services/company-recording-anyone-confirmation.service.js';
import { CompanyRecordingConfirmationService } from '../services/company-recording-confirmation.service.js';
import { requireLocalStaging } from '../services/local-recording-ingestion.service.js';

const recordingService = new RecordingService();
const companyJobs = new CompanyRecordingJobsService(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED);
const anyoneConfirmations = new CompanyRecordingAnyoneConfirmationService(client);

export const recordingsRouter = t.router({
  companyUploadCapability: protectedProcedure.query(() => companyRecordingCapability({ nodeEnv: env.NODE_ENV,
    jobsEnabled: env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED, localEnabled: env.LOCAL_RECORDING_STAGING_ENABLED,
    databaseUrl: env.DATABASE_URL, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL, administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID,
    tokenKey: env.GOOGLE_INTEGRATION_TOKEN_KEY }, async () => client.begin(async tx => {
      await tx`set local ylaam.local_staging_test='enabled'`;
      await tx`select local_recording_staging.require_disposable_test()`;
      const [row] = await tx`select c.encrypted_refresh_token as ciphertext from drive_integration_credentials c
        join drive_integration_generation g on g.id=c.id where c.id=1
        and to_regclass('public.company_recording_upload_jobs') is not null
        and to_regclass('public.company_recording_transfer_intents') is not null
        and to_regclass('public.company_recording_drive_verifications') is not null
        and to_regclass('local_recording_staging.verifications') is not null
        and to_regclass('local_recording_staging.chunks') is not null`;
      return row ? { ciphertext: row.ciphertext as string } : null;
    }))),
  createCompanyJob: protectedProcedure.input(z.object({
    recordingId: z.string().uuid(), meetingCode: z.string().min(1).max(80), occurrenceId: z.string().uuid().optional(),
    destinationFolderId: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/).nullable().optional(),
    mimeType: z.enum(['video/webm', 'video/mp4']), byteLength: z.number().int().positive().max(21474836480), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    recordingStartedAt: z.string().datetime(),
  }).strict()).mutation(({ input, ctx }) => companyJobs.create(input, ctx.user.id)),
  companyJobStatus: protectedProcedure.input(z.object({ jobId: z.string().uuid() }).strict())
    .query(({ input, ctx }) => companyJobs.status(input.jobId, ctx.user.id)),
  retryCompanyJob: protectedProcedure.input(z.object({ jobId: z.string().uuid() }).strict())
    .mutation(({ input, ctx }) => companyRecordingUploadOrchestrator().retry(input.jobId, ctx.user.id)),
  requestCompanyJobProcessing: protectedProcedure.input(z.object({ jobId: z.string().uuid() }).strict())
    .mutation(({ input, ctx }) => companyRecordingUploadOrchestrator().request(input.jobId, ctx.user.id)),
  companyJobProgress: protectedProcedure.input(z.object({ jobId: z.string().uuid() }).strict())
    .query(({ input, ctx }) => companyRecordingUploadOrchestrator().status(input.jobId, ctx.user.id)),
  verifiedCompanyRecording: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }).strict())
    .query(async ({ input, ctx }) => {
      requireLocalStaging({ nodeEnv: env.NODE_ENV, jobsEnabled: env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,
        localEnabled: env.LOCAL_RECORDING_STAGING_ENABLED, databaseUrl: env.DATABASE_URL });
      await requireFeature(ctx.user.id, 'recording', 'read');
      return client.begin(async tx => {
        await tx`set local ylaam.local_staging_test='enabled'`;
        await tx`select local_recording_staging.require_disposable_test()`;
        return new CompanyRecordingConfirmationService(tx as unknown as typeof client,
          (jobId, ownerId) => companyJobs.status(jobId, ownerId)).confirm(input.recordingId, ctx.user.id);
      });
    }),
  companyHistorySharing: protectedProcedure.input(z.object({ historyItemId: z.string().uuid() }).strict())
    .query(async ({input,ctx}) => {
      const [row] = await client`select j.id as job_id,p.policy_mode,p.policy_version,p.status,p.reconciliation_status,prior.policy_version as prior_version
        from meeting_history_items h join company_recording_upload_jobs j on h.meeting_id=j.meeting_id and h.dedupe_key=('company-drive:' || j.recording_id::text)
        join meetings m on m.id=j.meeting_id and m.host_user_id=${ctx.user.id}
        join company_recording_private_policies p on p.job_id=j.id and p.is_active and p.recording_id=j.recording_id and p.drive_file_id=j.verified_drive_file_id
        left join company_recording_private_policies prior on prior.superseded_by=p.id
        where h.id=${input.historyItemId} and h.kind='drive' and j.owner_user_id=${ctx.user.id} and j.state='completed'
          and h.content=('https://drive.google.com/file/d/' || j.verified_drive_file_id || '/view')`;
      if (!row) return null;
      return {jobId:String(row.job_id), mode:row.policy_mode as 'private'|'restricted'|'anyone_with_link', version:Number(row.policy_version),
        verified:row.status==='verified' && row.reconciliation_status==='resolved',
        previousVersion:row.prior_version == null ? null : Number(row.prior_version)};
    }),
  confirmAnyoneWithLink: protectedProcedure.input(z.object({ jobId: z.string().uuid(), policyVersion: z.number().int().positive() }).strict())
    .mutation(({ input, ctx }) => anyoneConfirmations.confirm(input.jobId, ctx.user.id, input.policyVersion)),
  changeCompanyRecordingSharing: protectedProcedure.input(z.object({ jobId:z.string().uuid(), targetMode:z.enum(['private','restricted','anyone_with_link']), expectedVersion:z.number().int().positive().max(2147483646) }).strict())
    .mutation(async ({input,ctx}) => { const result=await companyRecordingSharingRuntime().requestChange(input.jobId,ctx.user.id,input.targetMode,input.expectedVersion); return {state:result.state}; }),

  saveDriveReference: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
    url: z.string().max(1000), fileName: z.string().min(1).max(255),
  })).mutation(async ({ input, ctx }) => {
    await requireFeature(ctx.user.id, 'recording', 'write');
    const url = driveRecordingUrl(input.url);
    const meeting = await recordingService.authorizeExport(input, ctx.user.id);
    await new MeetingHistoryService().save({ meetingId: meeting.id, occurrenceId: input.occurrenceId,
      kind: 'drive', dedupeKey: `drive:${input.occurrenceId || 'meeting'}:${url.split('/')[5]}`, content: url, label: input.fileName });
    return { ok: true };
  }),
  authorizeExport: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1), occurrenceId: z.string().uuid().optional(),
  })).mutation(async ({ input, ctx }) => {
    await requireFeature(ctx.user.id, 'recording', 'read');
    await recordingService.authorizeExport(input, ctx.user.id);
    return { ok: true };
  }),

  createUpload: protectedProcedure.input(z.object({
    meetingCode: z.string().min(1),
    occurrenceId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    fileSize: z.number().int().positive(),
    durationSeconds: z.number().int().nonnegative(),
  })).mutation(async ({ input, ctx }) => {
    await requireFeature(ctx.user.id, 'recording', 'write');
    return recordingService.createUpload(input, ctx.user.id);
  }),

  complete: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user.id, 'recording', 'write');
      return recordingService.completeRecording(input.recordingId, ctx.user.id);
    }),

  retryUpload: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user.id, 'recording', 'write');
      return recordingService.retryUpload(input.recordingId, ctx.user.id);
    }),

  getForMeeting: protectedProcedure.input(z.object({ meetingCode: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await requireFeature(ctx.user.id, 'recording', 'read');
      return recordingService.getForMeeting(input.meetingCode, ctx.user.id);
    }),

  restrictedHistory: protectedProcedure.input(z.object({ meetingCode: z.string().min(1).max(80) }).strict())
    .query(async ({ input, ctx }) => {
      // The enrollment/account binding, approval, policy verification, and
      // exact batch folder must all match before a Drive reference is returned.
      return client`select h.id,h.content as url,h.label,h.created_at
        from meeting_history_items h join meetings m on m.id=h.meeting_id
        join company_recording_upload_jobs j on j.meeting_id=m.id
        join company_recording_private_policies p on p.job_id=j.id and p.policy_mode='restricted' and p.status='verified' and p.is_active and p.reconciliation_status='resolved'
        join batch_student_enrollments e on e.folder_id=m.recording_folder_id and e.status='approved'
        join batch_enrollment_account_bindings b on b.enrollment_id=e.id and b.user_id=${ctx.user.id}
        join users u on u.id=b.user_id and u.email_verified_at is not null
        join student_google_identities i on i.user_id=u.id and i.verified_at is not null
        join company_recording_private_readers r on r.policy_id=p.id and r.user_id=u.id and r.google_subject=i.google_subject and lower(r.google_email)=lower(i.google_email)
        join company_recording_private_acl_operations o on o.policy_id=p.id and o.user_id=u.id and o.state='applied' and o.permission_id is not null
        join company_recording_drive_verifications v on v.job_id=j.id and v.outcome='verified' and v.drive_file_id=j.verified_drive_file_id
        where m.meeting_code=${input.meetingCode.trim().toUpperCase()} and h.kind='drive'
          and j.access_policy='restricted' and j.state='completed' and j.destination_folder_id=m.recording_folder_id
          and p.recording_id=j.recording_id and p.drive_file_id=j.verified_drive_file_id
          and h.dedupe_key=('company-drive:' || j.recording_id::text)
        order by h.created_at desc`;
    }),

  downloadUrl: protectedProcedure.input(z.object({ recordingId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user.id, 'recording', 'read');
      return recordingService.getDownloadUrl(input.recordingId, ctx.user.id);
    }),
});
