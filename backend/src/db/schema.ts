import {
  pgTable,
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
import { sql } from 'drizzle-orm';

export const meetingStatusEnum = pgEnum('meeting_status', ['scheduled', 'live', 'ended']);
export const participantRoleEnum = pgEnum('participant_role', ['host', 'participant']);
export const participantAdmissionEnum = pgEnum('participant_admission', ['pending', 'admitted', 'denied']);
export const recordingStatusEnum = pgEnum('recording_status', ['created', 'completed', 'failed']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
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
    status: meetingStatusEnum('status').default('scheduled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meetings_host_user_idx').on(table.hostUserId),
    index('meetings_code_idx').on(table.meetingCode),
  ]
);

export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, {
      onDelete: 'cascade',
    }),
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
    uniqueIndex('participants_meeting_request_uidx').on(table.meetingId, table.joinRequestId),
    uniqueIndex('participants_active_user_uidx')
      .on(table.meetingId, table.userId)
      .where(sql`${table.userId} is not null and ${table.leftAt} is null`),
  ]
);

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id').notNull().references(() => meetings.id, {
      onDelete: 'cascade',
    }),
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
  ]
);
