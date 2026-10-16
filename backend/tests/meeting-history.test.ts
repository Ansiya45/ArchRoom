import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { MeetingHistoryService, driveRecordingUrl } = await import('../src/services/meeting-history.service.js');
const { meetingsRouter } = await import('../src/routers/meetings.js');
const { recordingsRouter } = await import('../src/routers/recordings.js');
const dialect = new PgDialect();

test('history list filters by creator on the server and bounds each page', async () => {
  const original = db.select; let condition: any, limit: number | undefined, offset: number | undefined;
  db.select = (() => ({ from: () => ({ where: (where: any) => { condition = where; return { orderBy: () => ({ limit: (value: number) => { limit = value; return { offset: async (value: number) => { offset = value; return []; } }; } }) }; } }) })) as any;
  try {
    await new MeetingHistoryService().list('creator', 30);
    const sql = dialect.sqlToQuery(condition);
    assert.match(sql.sql, /host_user_id/); assert.deepEqual(sql.params, ['creator']); assert.equal(limit, 30); assert.equal(offset, 30);
  } finally { db.select = original; }
});

test('detail requires both meeting id and creator id before querying content', async () => {
  const original = db.query.meetings.findFirst;
  let condition: any;
  db.query.meetings.findFirst = (async ({ where }: any) => { condition = where; return undefined; }) as any;
  try {
    await assert.rejects(() => new MeetingHistoryService().detail('meeting', 'outsider'), { code: 'NOT_FOUND' });
    const sql = dialect.sqlToQuery(condition);
    assert.match(sql.sql, /host_user_id/); assert.deepEqual(sql.params, ['meeting', 'outsider']);
  } finally { db.query.meetings.findFirst = original; }
});

test('anonymous users cannot list history, read details, or save Drive references', async () => {
  const caller = meetingsRouter.createCaller({ user: null } as any);
  await assert.rejects(() => caller.history({ offset: 0 }), { code: 'UNAUTHORIZED' });
  await assert.rejects(() => caller.historyDetail({ meetingId: '11111111-1111-4111-8111-111111111111' }), { code: 'UNAUTHORIZED' });
  await assert.rejects(() => recordingsRouter.createCaller({ user: null } as any).saveDriveReference({ meetingCode: 'YLM-ABC234', url: 'https://drive.google.com/file/d/example/view', fileName: 'recording.mp4' }), { code: 'UNAUTHORIZED' });
});

test('Drive references accept only canonical Google file links, never credentials or arbitrary URLs', () => {
  assert.equal(driveRecordingUrl('https://drive.google.com/file/d/file_123/view?usp=sharing'), 'https://drive.google.com/file/d/file_123/view');
  for (const value of ['javascript:alert(1)', 'https://drive.google.com.evil.test/file/d/a/view', 'https://user:password@drive.google.com/file/d/a/view', 'http://drive.google.com/file/d/a/view', 'https://drive.google.com/drive/folders/a']) assert.throws(() => driveRecordingUrl(value));
});

test('saving a transcript or Drive retry is idempotent', async () => {
  const original = db.insert; let conflict = false, value: any;
  db.insert = (() => ({ values: (input: any) => { value = input; return { onConflictDoNothing: async () => { conflict = true; } }; } })) as any;
  try {
    await new MeetingHistoryService().save({ meetingId: 'meeting', kind: 'transcript', dedupeKey: 'request:clip', content: 'Hello' });
    assert.equal(value.content, 'Hello'); assert.equal(conflict, true);
  } finally { db.insert = original; }
});

test('saving a Drive reference enforces recording host authorization and stores only metadata', async () => {
  const { RecordingService } = await import('../src/services/recording.service.js');
  const { TRPCError } = await import('@trpc/server');
  const originalAuthorize = RecordingService.prototype.authorizeExport, originalSave = MeetingHistoryService.prototype.save;
  let saved: any;
  const caller = recordingsRouter.createCaller({ isAuthenticated: true, user: { id: 'creator' } } as any);
  const input = { meetingCode: 'YLM-ABC234', occurrenceId: '22222222-2222-4222-8222-222222222222', url: 'https://drive.google.com/file/d/example/view', fileName: 'recording.mp4' };
  MeetingHistoryService.prototype.save = async value => { saved = value; };
  try {
    RecordingService.prototype.authorizeExport = async () => { throw new TRPCError({ code: 'FORBIDDEN' }); };
    await assert.rejects(() => caller.saveDriveReference(input), { code: 'FORBIDDEN' }); assert.equal(saved, undefined);
    RecordingService.prototype.authorizeExport = async (scope, userId) => {
      assert.equal(userId, 'creator'); assert.equal(scope.occurrenceId, input.occurrenceId);
      return { id: 'meeting' } as any;
    };
    await caller.saveDriveReference(input);
    assert.equal(saved.meetingId, 'meeting'); assert.equal(saved.occurrenceId, input.occurrenceId);
    assert.equal(saved.kind, 'drive'); assert.equal(saved.content, input.url); assert.equal(saved.label, input.fileName);
    assert.equal('token' in saved, false);
  } finally { RecordingService.prototype.authorizeExport = originalAuthorize; MeetingHistoryService.prototype.save = originalSave; }
});
