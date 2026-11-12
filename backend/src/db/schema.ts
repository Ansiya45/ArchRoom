import {
  pgTable,
  boolean,
  jsonb,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  bigint,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { RecurrenceSegment } from '../services/recurrence-series.service.js';
import type { RecurrenceRule } from '../services/recurrence.service.js';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const meetingStatusEnum = pgEnum('meeting_status', ['scheduled', 'live', 'ended']);
export const meetingScheduleTypeEnum = pgEnum('meeting_schedule_type', ['one_time', 'reusable', 'recurring']);
export const participantRoleEnum = pgEnum('participant_role', ['host', 'participant']);
export const participantAdmissionEnum = pgEnum('participant_admission', ['pending', 'admitted', 'denied']);
export const recordingStatusEnum = pgEnum('recording_status', ['created', 'completed', 'failed']);
export const authCodePurposeEnum = pgEnum('auth_code_purpose', ['verify_email', 'reset_password']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
  ]
);

// Stage A: app permissions are separate from Google Drive sharing permissions.
export const recordingBatchFolders = pgTable('recording_batch_folders', {
  folderId: text('folder_id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recordingBatchFolderPermissions = pgTable('recording_batch_folder_permissions', {
  folderId: text('folder_id').notNull().references(() => recordingBatchFolders.folderId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).$type<'manager' | 'trainer' | 'viewer'>().notNull(),
}, table => [primaryKey({ columns: [table.folderId, table.userId] }), index('recording_batch_folder_permissions_user_idx').on(table.userId)]);

export const batchStudentEnrollments = pgTable('batch_student_enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  folderId: text('folder_id').notNull().references(() => recordingBatchFolders.folderId, { onDelete: 'cascade' }),
  studentName: varchar('student_name', { length: 120 }).notNull(),
  studentEmail: varchar('student_email', { length: 255 }).notNull(),
  source: text('source').$type<'manual' | 'registration'>().notNull().default('manual'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  status: text('status').$type<'pending' | 'approved' | 'removed'>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  approvedBy: uuid('approved_by'), removedAt: timestamp('removed_at', { withTimezone: true }), removedBy: uuid('removed_by'),
}, table => [uniqueIndex('batch_student_enrollments_folder_email_idx').on(table.folderId, table.studentEmail)]);

export const batchStudentEnrollmentEvents = pgTable('batch_student_enrollment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentId: uuid('enrollment_id').notNull().references(() => batchStudentEnrollments.id, { onDelete: 'cascade' }),
  action: text('action').$type<'added' | 'approved' | 'removed' | 'reapproved' | 'registered' | 'email_verified'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('batch_student_enrollment_events_enrollment_idx').on(table.enrollmentId, table.occurredAt, table.id)]);

export const batchEnrollmentAccountBindings = pgTable('batch_enrollment_account_bindings', {
  enrollmentId: uuid('enrollment_id').primaryKey().references(() => batchStudentEnrollments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('batch_enrollment_account_bindings_user_idx').on(table.userId, table.enrollmentId)]);

export const batchRegistrationLinks = pgTable('batch_registration_links', {
  folderId: text('folder_id').primaryKey().references(() => recordingBatchFolders.folderId, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }), createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const batchRegistrationVerifications = pgTable('batch_registration_verifications', {
  tokenHash: text('token_hash').primaryKey(),
  enrollmentId: uuid('enrollment_id').notNull().references(() => batchStudentEnrollments.id, { onDelete: 'cascade' }),
  linkHash: text('link_hash').notNull(), requestedName: varchar('requested_name', { length: 120 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('batch_registration_verifications_enrollment_idx').on(table.enrollmentId)]);
export const batchRegistrationLimits = pgTable('batch_registration_limits', {
  keyHash: text('key_hash').primaryKey(), windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(), attempts: integer('attempts').notNull(),
});
export const studentGoogleIdentities = pgTable('student_google_identities', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  googleSubject: text('google_subject').unique(), googleEmail: text('google_email'), verifiedAt: timestamp('verified_at', { withTimezone: true }),
});

// Global permission to create a new direct child of the configured root.
// A manager assignment on an existing folder does not imply this grant.
export const recordingFolderCreators = pgTable('recording_folder_creators', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  grantedByUserId: uuid('granted_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A durable singleton serializes disconnects and credential writes across instances.
export const driveIntegrationGeneration = pgTable('drive_integration_generation', {
  id: integer('id').primaryKey(),
  generation: uuid('generation').notNull(),
});

// Only ciphertext is persisted. The encryption key is provided separately at runtime.
export const driveIntegrationCredentials = pgTable('drive_integration_credentials', {
  id: integer('id').primaryKey(),
  googleAccountEmail: varchar('google_account_email', { length: 255 }).notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  connectedByUserId: uuid('connected_by_user_id').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  passwordVersion: varchar('password_version', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('auth_sessions_user_idx').on(table.userId)]);

export const authCodes = pgTable(
  'auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: authCodePurposeEnum('purpose').notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('auth_codes_user_purpose_idx').on(table.userId, table.purpose),
  ]
);

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingCode: varchar('meeting_code', { length: 80 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    recordingFolderId: text('recording_folder_id'),
    recordingAccessPolicy: text('recording_access_policy').$type<'private' | 'restricted' | 'anyone_with_link'>().notNull().default('private'),
    hostUserId: uuid('host_user_id').notNull().references(() => users.id, {
      onDelete: 'cascade',
    }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    // NULL preserves the behavior of legacy and instant meetings.
    scheduleType: meetingScheduleTypeEnum('schedule_type'),
    timeZone: varchar('time_zone', { length: 100 }),
    recurrenceRule: jsonb('recurrence_rule').$type<RecurrenceRule>(),
    recurrenceRevision: integer('recurrence_revision').notNull().default(0),
    recurrenceHistory: jsonb('recurrence_history').$type<RecurrenceSegment[]>().notNull().default([]),
    recurrenceCancelledAt: timestamp('recurrence_cancelled_at', { withTimezone: true }),
    recurrenceEditedAt: timestamp('recurrence_edited_at', { withTimezone: true }),
    activeOccurrenceId: uuid('active_occurrence_id').references((): AnyPgColumn => meetingOccurrences.id),
    status: meetingStatusEnum('status').default('scheduled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meetings_host_user_idx').on(table.hostUserId),
    index('meetings_code_idx').on(table.meetingCode),
  ]
);

// Per-user dashboard state. Hiding a card does not delete the meeting or its history.
export const meetingPreferences = pgTable('meeting_preferences', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  favorite: boolean('favorite').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.userId, table.meetingId] }), index('meeting_preferences_user_idx').on(table.userId)]);

export const meetingOccurrences = pgTable('meeting_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references((): AnyPgColumn => meetings.id, { onDelete: 'cascade' }),
  startRequestId: uuid('start_request_id'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  originalScheduledAt: timestamp('original_scheduled_at', { withTimezone: true }),
  recurrenceRevision: integer('recurrence_revision').notNull().default(0),
  timeZone: varchar('time_zone', { length: 100 }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: varchar('cancellation_reason', { length: 30 }),
  status: meetingStatusEnum('status').notNull().default('live'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [
  index('occurrences_meeting_idx').on(table.meetingId),
  uniqueIndex('occurrences_original_start_uidx').on(table.meetingId, table.recurrenceRevision, table.originalScheduledAt),
  uniqueIndex('occurrences_start_request_uidx').on(table.meetingId, table.startRequestId),
  uniqueIndex('occurrences_one_live_uidx').on(table.meetingId).where(sql`${table.status} = 'live'`),
]);

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, {
      onDelete: 'cascade',
    }),
    occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    guestName: varchar('guest_name', { length: 120 }),
    joinRequestId: uuid('join_request_id'),
    role: participantRoleEnum('role').default('participant').notNull(),
    admission: participantAdmissionEnum('admission').default('pending').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    index('participants_meeting_idx').on(table.meetingId),
    index('participants_user_idx').on(table.userId),
    uniqueIndex('participants_meeting_request_uidx').on(table.meetingId, table.joinRequestId).where(sql`${table.occurrenceId} is null`),
    uniqueIndex('participants_occurrence_request_uidx').on(table.occurrenceId, table.joinRequestId),
    index('participants_occurrence_idx').on(table.occurrenceId),
    uniqueIndex('participants_active_user_uidx')
      .on(table.meetingId, table.userId)
      .where(sql`${table.userId} is not null and ${table.leftAt} is null`),
  ]
);

export const meetingAiRequests = pgTable('meeting_ai_requests', {
  meetingId: uuid('meeting_id').primaryKey().references(() => meetings.id, { onDelete: 'cascade' }),
  occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id),
  requestId: uuid('request_id').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
});

// Text and external references only; never audio blobs or Google credentials.
export const meetingHistoryItems = pgTable('meeting_history_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 20 }).$type<'transcript' | 'summary' | 'drive'>().notNull(),
  dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
  content: text('content').notNull(),
  label: varchar('label', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('meeting_history_dedupe_uidx').on(table.meetingId, table.dedupeKey), index('meeting_history_meeting_idx').on(table.meetingId)]);

export const meetingAiConsents = pgTable('meeting_ai_consents', {
  requestId: uuid('request_id').notNull(),
  participantId: uuid('participant_id').notNull().references(() => meetingParticipants.id, { onDelete: 'cascade' }),
  agreed: boolean('agreed').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.requestId, table.participantId] })]);

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, {
      onDelete: 'cascade',
    }),
    occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }),
    fileSize: bigint('file_size', { mode: 'number' }),
    durationSeconds: integer('duration_seconds'),
    status: recordingStatusEnum('status').default('created').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('recordings_meeting_idx').on(table.meetingId),
    index('recordings_occurrence_idx').on(table.occurrenceId),
  ]
);

// Scheduling recipients are invitations, never admitted meeting participants.
export const meetingInvitations = pgTable('meeting_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  remindersEnabled: boolean('reminders_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('meeting_invitations_email_uidx').on(table.meetingId, table.email)]);

export const meetingDeliveries = pgTable('meeting_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  invitationId: uuid('invitation_id').notNull().references(() => meetingInvitations.id, { onDelete: 'cascade' }),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id),
  // Includes schedule instant; rescheduling invalidates an old reminder without changing meeting identity.
  deliveryKey: varchar('delivery_key', { length: 255 }).notNull().unique(),
  kind: varchar('kind', { length: 20 }).$type<'invitation' | 'reminder'>().notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).$type<'pending' | 'sent' | 'skipped' | 'failed'>().notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  // Frozen before the first network request so provider retries have identical payloads.
  payload: jsonb('payload').$type<{ from: string; to: string; subject: string; html: string }>(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, table => [index('meeting_deliveries_due_idx').on(table.status, table.dueAt)]);

// Company Drive job metadata only; media and Google credentials are never stored here.
export const companyRecordingUploadJobs = pgTable('company_recording_upload_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordingId: uuid('recording_id').notNull().unique(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  occurrenceId: uuid('occurrence_id').references(() => meetingOccurrences.id, { onDelete: 'cascade' }),
  destinationFolderId: text('destination_folder_id').notNull(),
  accessPolicy: text('access_policy').$type<'private' | 'restricted' | 'anyone_with_link'>().notNull(),
  mimeType: text('mime_type').notNull(),
  byteLength: bigint('byte_length', { mode: 'number' }).notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  recordingStartedAt: timestamp('recording_started_at', { withTimezone: true }),
  recordingTitle: varchar('recording_title', { length: 255 }),
  recordingTimeZone: varchar('recording_time_zone', { length: 100 }),
  recordingFilename: text('recording_filename'),
  driveFileId: text('drive_file_id').unique(),
  encryptedSession: text('encrypted_session'),
  state: text('state').$type<'pending' | 'uploading' | 'retryable' | 'verifying' | 'completed' | 'failed'>().notNull().default('pending'),
  confirmedOffset: bigint('confirmed_offset', { mode: 'number' }).notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  errorCode: text('error_code'),
  verifiedDriveFileId: text('verified_drive_file_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, table => [index('company_recording_upload_jobs_owner_idx').on(table.ownerUserId, table.createdAt), index('company_recording_upload_jobs_meeting_idx').on(table.meetingId)]);

export const companyRecordingPrivatePolicies = pgTable('company_recording_private_policies', {
  id: uuid('id').primaryKey().defaultRandom(), jobId: uuid('job_id').notNull().references(() => companyRecordingUploadJobs.id),
  recordingId: uuid('recording_id').notNull(), driveFileId: text('drive_file_id').notNull(), destinationFolderId: text('destination_folder_id').notNull(),
  companyAccountEmail: varchar('company_account_email', { length: 255 }).notNull(), credentialGeneration: uuid('credential_generation').notNull(),
  policyMode: text('policy_mode').$type<'private'|'restricted'|'anyone_with_link'>().notNull().default('private'), policyVersion: integer('policy_version').notNull(), hostConfirmed: boolean('host_confirmed').notNull().default(false), publicPermissionId: text('public_permission_id'), sharingVersion: integer('sharing_version').notNull().default(1),
  status: text('status').$type<'pending'|'applying'|'verified'|'blocked'|'reconciliation_required'>().notNull().default('pending'),
  leaseToken: uuid('lease_token'), leaseEpoch: bigint('lease_epoch', { mode: 'number' }).notNull().default(0), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  reconciliationStatus: text('reconciliation_status').$type<'not_required'|'required'|'resolved'>().notNull().default('not_required'),
  isActive: boolean('is_active').notNull().default(true), supersededAt: timestamp('superseded_at', { withTimezone: true }), supersededBy: uuid('superseded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('company_recording_private_policies_lease_idx').on(table.status, table.leaseUntil)]);
export const companyRecordingAnyoneConfirmations = pgTable('company_recording_anyone_confirmations', {
  id: uuid('id').primaryKey().defaultRandom(), jobId: uuid('job_id').notNull().references(() => companyRecordingUploadJobs.id, { onDelete: 'cascade' }), recordingId: uuid('recording_id').notNull(), hostUserId: uuid('host_user_id').notNull().references(() => users.id), policyVersion: integer('policy_version').notNull(), confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(), consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, table => [uniqueIndex('company_recording_anyone_confirmations_version_uidx').on(table.jobId, table.policyVersion)]);
export const companyRecordingPrivateReaders = pgTable('company_recording_private_readers', {
  policyId: uuid('policy_id').notNull().references(() => companyRecordingPrivatePolicies.id, { onDelete: 'cascade' }), userId: uuid('user_id').notNull(), googleSubject: text('google_subject').notNull(), googleEmail: varchar('google_email', { length: 255 }).notNull(), role: text('role').$type<'reader'>().notNull().default('reader'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.policyId, table.userId] }), uniqueIndex('company_recording_private_readers_subject_uidx').on(table.policyId, table.googleSubject), uniqueIndex('company_recording_private_readers_email_uidx').on(table.policyId, table.googleEmail)]);
export const companyRecordingPrivateAclOperations = pgTable('company_recording_private_acl_operations', {
  id: uuid('id').primaryKey().defaultRandom(), policyId: uuid('policy_id').notNull().references(() => companyRecordingPrivatePolicies.id, { onDelete: 'cascade' }), userId: uuid('user_id'), googleSubject: text('google_subject'), googleEmail: varchar('google_email', { length: 255 }), desiredRole: text('desired_role').$type<'reader'>().notNull().default('reader'), operationKind: text('operation_kind').$type<'direct_reader'|'anyone_reader'>().notNull().default('direct_reader'), permissionId: text('permission_id'), state: text('state').$type<'pending'|'in_progress'|'applied'|'retryable'|'reconciliation_required'|'revoked'>().notNull().default('pending'), fencingEpoch: bigint('fencing_epoch', { mode: 'number' }).notNull().default(0), leaseToken: uuid('lease_token'), leaseUntil: timestamp('lease_until', { withTimezone: true }), providerResult: text('provider_result'), failureCode: text('failure_code'), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('company_recording_private_acl_operations_uidx').on(table.policyId, table.userId)]);
export const companyRecordingPrivateAclAudit = pgTable('company_recording_private_acl_audit', {
  id: uuid('id').primaryKey().defaultRandom(), operationId: uuid('operation_id').notNull().references(() => companyRecordingPrivateAclOperations.id, { onDelete: 'cascade' }), policyId: uuid('policy_id').notNull().references(() => companyRecordingPrivatePolicies.id, { onDelete: 'cascade' }), action: text('action').notNull(), permissionId: text('permission_id'), fencingEpoch: bigint('fencing_epoch', { mode: 'number' }).notNull(), detail: text('detail'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('company_recording_private_acl_audit_policy_idx').on(table.policyId, table.createdAt)]);
