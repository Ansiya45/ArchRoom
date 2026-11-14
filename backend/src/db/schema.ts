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
export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'user']);
export const featureLevelEnum = pgEnum('feature_level', ['none', 'read', 'write', 'full']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    role: userRoleEnum('role').notNull().default('user'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
  ]
);

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    feature: varchar('feature', { length: 40 }).notNull(),
    level: featureLevelEnum('level').notNull().default('none'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.feature] })]
);

export const userInvitations = pgTable(
  'user_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('user'),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    invitedBy: uuid('invited_by').notNull().references(() => users.id),
    permissions: jsonb('permissions').$type<Record<string, string>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('user_invitations_email_idx').on(table.email)]
);

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
    transcriptAccess: varchar('transcript_access', { length: 10 }).notNull().default('all'),
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
