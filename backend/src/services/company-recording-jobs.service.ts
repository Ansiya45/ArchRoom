import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { companyRecordingUploadJobs, meetingOccurrences, meetingParticipants, meetings } from '../db/schema.js';
import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';
import { RecordingService } from './recording.service.js';
import { companyRecordingSharingReadiness } from './company-recording-sharing-readiness.js';
import { validateCompanyRecordingDestination } from './google-drive-integration.runtime.js';
import type { DestinationPrivacyResult } from './recording-destination-privacy.service.js';
import { companyRecordingFilename } from './company-recording-filename.js';
import { validateRecordingDestination } from './recording-folder-access.service.js';

export type CompanyJobInput = { recordingId: string; meetingCode: string; occurrenceId?: string; destinationFolderId?: string | null;
  mimeType: 'video/webm' | 'video/mp4'; byteLength: number; sha256: string; recordingStartedAt?: string };
const publicJob = { id: companyRecordingUploadJobs.id, recordingId: companyRecordingUploadJobs.recordingId,
  meetingId: companyRecordingUploadJobs.meetingId, occurrenceId: companyRecordingUploadJobs.occurrenceId,
  mimeType: companyRecordingUploadJobs.mimeType, byteLength: companyRecordingUploadJobs.byteLength,
  state: companyRecordingUploadJobs.state, confirmedOffset: companyRecordingUploadJobs.confirmedOffset,
  retryCount: companyRecordingUploadJobs.retryCount, errorCode: companyRecordingUploadJobs.errorCode,
  createdAt: companyRecordingUploadJobs.createdAt, updatedAt: companyRecordingUploadJobs.updatedAt, completedAt: companyRecordingUploadJobs.completedAt };

export class CompanyRecordingJobsService {
  constructor(private readonly enabled: boolean, private readonly privacy = validateCompanyRecordingDestination,
    private readonly readiness: () => {ready:boolean; reason:string} = companyRecordingSharingReadiness,
    private readonly validateFolder = validateRecordingDestination) {}
  private requireEnabled() { if (!this.enabled) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Company recording uploads are unavailable.' }); }
  private validateInput(input: CompanyJobInput) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.recordingId) ||
      !['video/webm', 'video/mp4'].includes(input.mimeType) || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 21474836480 ||
      !/^[a-f0-9]{64}$/.test(input.sha256) || (input.recordingStartedAt !== undefined && (!Number.isFinite(Date.parse(input.recordingStartedAt)) || Date.parse(input.recordingStartedAt) > Date.now() + 300000))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid recording metadata.' });
  }
  async create(input: CompanyJobInput, userId: string) {
    this.requireEnabled(); this.validateInput(input);
    // Reuse the existing meeting/session rules before the transaction; the
    // transaction repeats the authorization while holding the relevant rows.
    const authorizedMeeting = await new RecordingService().authorizeExport(input, userId);
    const requestedFolder = input.destinationFolderId !== undefined ? input.destinationFolderId : authorizedMeeting.recordingFolderId;
    const validatedFolder = await this.validateFolder(userId, requestedFolder ?? null);
    return db.transaction(async tx => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.meetingCode, input.meetingCode.trim().toUpperCase())).for('update');
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found.' });
      if (meeting.scheduleType === 'reusable' || meeting.scheduleType === 'recurring') {
        if (!input.occurrenceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting session is required.' });
        const [occurrence] = await tx.select({ id: meetingOccurrences.id }).from(meetingOccurrences).where(and(eq(meetingOccurrences.id, input.occurrenceId), eq(meetingOccurrences.meetingId, meeting.id))).for('update');
        if (!occurrence) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meeting session is invalid.' });
      } else if (input.occurrenceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This meeting has no room sessions.' });
      if (meeting.hostUserId !== userId) {
        const [host] = await tx.select({ id: meetingParticipants.id }).from(meetingParticipants).where(and(eq(meetingParticipants.meetingId, meeting.id),
          input.occurrenceId ? eq(meetingParticipants.occurrenceId, input.occurrenceId) : isNull(meetingParticipants.occurrenceId),
          eq(meetingParticipants.userId, userId), eq(meetingParticipants.role, 'host'), eq(meetingParticipants.admission, 'admitted'))).for('update');
        if (!host) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can access recordings.' });
      }
      if (meeting.recordingFolderId !== authorizedMeeting.recordingFolderId ||
          (meeting.recordingFolderId !== null && validatedFolder !== meeting.recordingFolderId))
        throw new TRPCError({ code: 'CONFLICT', message: 'The saved recording destination changed. Choose the folder again.' });
      const destination = validatedFolder ?? recordingDriveRootId();
      validateDriveFolderId(destination);
      const recordingStartedAt=input.recordingStartedAt ? new Date(input.recordingStartedAt) : null;
      const values = { recordingId: input.recordingId, ownerUserId: userId, meetingId: meeting.id, occurrenceId: input.occurrenceId ?? null,
        destinationFolderId: destination, accessPolicy: meeting.recordingAccessPolicy, mimeType: input.mimeType, byteLength: input.byteLength, sha256: input.sha256,
        recordingStartedAt, recordingTitle:recordingStartedAt ? meeting.title : null, recordingTimeZone:recordingStartedAt ? meeting.timeZone : null,
        recordingFilename:recordingStartedAt ? companyRecordingFilename(meeting.title,meeting.timeZone,recordingStartedAt,input.recordingId,input.mimeType) : null };
      const [created] = await tx.insert(companyRecordingUploadJobs).values(values).onConflictDoNothing({ target: companyRecordingUploadJobs.recordingId }).returning(publicJob);
      if (created) return created;
      const [existing] = await tx.select().from(companyRecordingUploadJobs).where(and(eq(companyRecordingUploadJobs.recordingId, input.recordingId), eq(companyRecordingUploadJobs.ownerUserId, userId))).for('update');
      if (existing && existing.destinationFolderId !== values.destinationFolderId)
        throw new TRPCError({ code: 'CONFLICT', message: 'This recording already has an upload job for its original folder. Retry or review that job; changing the folder cannot retarget it.' });
      if (!existing || existing.meetingId !== values.meetingId || existing.occurrenceId !== values.occurrenceId || existing.destinationFolderId !== values.destinationFolderId ||
          existing.accessPolicy !== values.accessPolicy || existing.mimeType !== values.mimeType || existing.byteLength !== values.byteLength || existing.sha256 !== values.sha256 ||
          (existing.recordingStartedAt?.getTime() ?? null) !== (recordingStartedAt?.getTime() ?? null))
        throw new TRPCError({ code: 'CONFLICT', message: 'Recording job could not be created.' });
      const [result] = await tx.select(publicJob).from(companyRecordingUploadJobs).where(eq(companyRecordingUploadJobs.id, existing.id));
      return result;
    });
  }
  async status(id: string, userId: string) {
    this.requireEnabled();
    const [row] = await db.select({ job: publicJob, code: meetings.meetingCode }).from(companyRecordingUploadJobs)
      .innerJoin(meetings, eq(meetings.id, companyRecordingUploadJobs.meetingId))
      .where(and(eq(companyRecordingUploadJobs.id, id), eq(companyRecordingUploadJobs.ownerUserId, userId)));
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording job not found.' });
    await new RecordingService().authorizeExport({ meetingCode: row.code, occurrenceId: row.job.occurrenceId ?? undefined }, userId);
    return row.job;
  }
  async retry(id: string, userId: string) {
    this.requireEnabled();
    const existing = await this.status(id, userId);
    return db.transaction(async tx => {
      const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, existing.meetingId)).for('update');
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording job not found.' });
      if (meeting.hostUserId !== userId) {
        const [host] = await tx.select({ id: meetingParticipants.id }).from(meetingParticipants).where(and(eq(meetingParticipants.meetingId, meeting.id),
          existing.occurrenceId ? eq(meetingParticipants.occurrenceId, existing.occurrenceId) : isNull(meetingParticipants.occurrenceId),
          eq(meetingParticipants.userId, userId), eq(meetingParticipants.role, 'host'), eq(meetingParticipants.admission, 'admitted'))).for('update');
        if (!host) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the meeting host can access recordings.' });
      }
      const [row] = await tx.update(companyRecordingUploadJobs).set({ state: 'pending', errorCode: null,
        retryCount: sql`${companyRecordingUploadJobs.retryCount} + 1`, updatedAt: new Date() }).where(and(eq(companyRecordingUploadJobs.id, id),
          eq(companyRecordingUploadJobs.ownerUserId, userId), eq(companyRecordingUploadJobs.state, 'retryable'))).returning(publicJob);
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Recording job is unavailable for retry.' });
      return row;
    });
  }
  // A saved recording's policy may differ from the meeting's original default.
  // This path retains destination and host checks without changing the initial
  // upload validator's meeting-policy comparison.
  async validateExistingRecordingDestination(id: string, userId: string): Promise<DestinationPrivacyResult> {
    this.requireEnabled();
    const readiness = this.readiness();
    if (!readiness.ready) return { status:'BLOCKED', reason:readiness.reason };
    const [row] = await db.select({ job:companyRecordingUploadJobs, code:meetings.meetingCode, host:meetings.hostUserId, folder:meetings.recordingFolderId })
      .from(companyRecordingUploadJobs).innerJoin(meetings, eq(meetings.id, companyRecordingUploadJobs.meetingId))
      .where(and(eq(companyRecordingUploadJobs.id,id), eq(companyRecordingUploadJobs.ownerUserId,userId)));
    if (!row || row.host !== userId || !['pending','completed'].includes(row.job.state))
      return { status:'BLOCKED', reason:'Recording destination or host is unavailable.' };
    await this.status(id,userId);
    const result = await this.privacy({ meetingCode:row.code, occurrenceId:row.job.occurrenceId ?? undefined },userId,row.job.destinationFolderId);
    if (result.status !== 'SAFE' || result.destinationId !== row.job.destinationFolderId) return { status:'BLOCKED', reason:'Recording destination is not verified.' };
    const [latest] = await db.select({ folder:meetings.recordingFolderId,host:meetings.hostUserId,destination:companyRecordingUploadJobs.destinationFolderId })
      .from(companyRecordingUploadJobs).innerJoin(meetings,eq(meetings.id,companyRecordingUploadJobs.meetingId))
      .where(and(eq(companyRecordingUploadJobs.id,id),eq(companyRecordingUploadJobs.ownerUserId,userId)));
    if (!latest || latest.host !== userId || latest.destination !== row.job.destinationFolderId)
      return { status:'BLOCKED', reason:'Recording destination or host changed.' };
    return result;
  }
  // Future transfer code must call this immediately before creating a file.
  // This returns a fresh result and never stores or caches a SAFE decision.
  async validateImmediatelyBeforeFileCreation(id: string, userId: string): Promise<DestinationPrivacyResult> {
    this.requireEnabled();
    const [row] = await db.select({ job: companyRecordingUploadJobs, code: meetings.meetingCode, folder: meetings.recordingFolderId, policy: meetings.recordingAccessPolicy })
      .from(companyRecordingUploadJobs).innerJoin(meetings, eq(meetings.id, companyRecordingUploadJobs.meetingId))
      .where(and(eq(companyRecordingUploadJobs.id, id), eq(companyRecordingUploadJobs.ownerUserId, userId)));
    if (!row || row.job.state !== 'pending') return { status: 'BLOCKED', reason: 'Recording job is unavailable.' };
    // All selected modes remain blocked until their actual file ACLs can be
    // applied and independently verified. In particular, owner-only is not
    // equivalent to the requested Private host/manager sharing policy.
    const readiness = this.readiness();
    if (!readiness.ready)
      return { status: 'BLOCKED', reason: readiness.reason };
    const result = await this.privacy({ meetingCode: row.code, occurrenceId: row.job.occurrenceId ?? undefined }, userId, row.job.destinationFolderId);
    if (result.status === 'SAFE' && result.destinationId !== row.job.destinationFolderId) return { status: 'BLOCKED', reason: 'Recording destination changed.' };
    if (result.status === 'SAFE') {
      await this.status(id, userId);
      const [latest] = await db.select({ state: companyRecordingUploadJobs.state, folder: meetings.recordingFolderId, policy: meetings.recordingAccessPolicy })
        .from(companyRecordingUploadJobs).innerJoin(meetings, eq(meetings.id, companyRecordingUploadJobs.meetingId))
        .where(and(eq(companyRecordingUploadJobs.id, id), eq(companyRecordingUploadJobs.ownerUserId, userId)));
      if (!latest || latest.state !== 'pending')
        return { status: 'BLOCKED', reason: 'Recording destination changed.' };
    }
    return result;
  }
}
