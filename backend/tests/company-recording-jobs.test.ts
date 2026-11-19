import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envSchema } from '../src/env.js';
import { CompanyRecordingJobsService } from '../src/services/company-recording-jobs.service.js';
import { RecordingService } from '../src/services/recording.service.js';
import { db } from '../src/db/index.js';

const input = { recordingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', meetingCode: 'YLM-ABC234', mimeType: 'video/webm' as const, byteLength: 30, sha256: 'a'.repeat(64) };
test('company upload jobs are off by default and reject operations before external work', async () => {
  assert.equal(envSchema.parse({ DATABASE_URL: 'test', JWT_SECRET: 'test' }).COMPANY_DRIVE_UPLOAD_JOBS_ENABLED, false);
  let calls = 0;
  const service = new CompanyRecordingJobsService(false, async () => { calls++; throw new Error('must not run'); });
  await assert.rejects(service.create(input, 'user'), /unavailable/);
  await assert.rejects(service.status('job', 'user'), /unavailable/);
  await assert.rejects(service.retry('job', 'user'), /unavailable/);
  await assert.rejects(service.validateImmediatelyBeforeFileCreation('job', 'user'), /unavailable/);
  assert.equal(calls, 0);
});
test('invalid recording metadata is rejected before database work', async () => {
  const service = new CompanyRecordingJobsService(true, async () => { throw new Error('must not run'); });
  for (const bad of [{ ...input, recordingId: 'bad' }, { ...input, byteLength: 0 }, { ...input, byteLength: 21474836481 },
    { ...input, byteLength: 1.5 }, { ...input, sha256: 'G'.repeat(64) }]) await assert.rejects(service.create(bad, 'user'));
});

test('job creation accepts an authorized explicit folder without changing the meeting default', async () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const meeting = { id: '22222222-2222-4222-8222-222222222222', meetingCode: input.meetingCode,
    hostUserId: owner, scheduleType: 'one_time', recordingFolderId: 'folderAAAAAAAAAAAAAA', recordingAccessPolicy: 'private' };
  const originalAuthorize = RecordingService.prototype.authorizeExport;
  const originalTransaction = db.transaction;
  let saved: Record<string, unknown> | undefined;
  try {
    RecordingService.prototype.authorizeExport = (async () => meeting) as typeof originalAuthorize;
    db.transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [meeting] }) }) }),
      insert: () => ({ values: (values: Record<string, unknown>) => {
        saved = values;
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'job', recordingId: input.recordingId }] }) };
      } }),
    })) as typeof originalTransaction;
    const checked: Array<string | null> = [];
    const service = new CompanyRecordingJobsService(true, undefined, undefined, async (_user, folder) => {
      checked.push(folder);
      if (folder !== 'folderBBBBBBBBBBBBBB') throw new Error('not authorized');
      return folder;
    });
    await service.create({ ...input, destinationFolderId: 'folderBBBBBBBBBBBBBB' }, owner);
    assert.deepEqual(checked, ['folderBBBBBBBBBBBBBB']);
    assert.equal(saved?.destinationFolderId, 'folderBBBBBBBBBBBBBB');
    assert.equal(meeting.recordingFolderId, 'folderAAAAAAAAAAAAAA');
    await assert.rejects(service.create({ ...input, destinationFolderId: 'forbidden' }, owner), /not authorized/);
  } finally {
    RecordingService.prototype.authorizeExport = originalAuthorize;
    db.transaction = originalTransaction;
  }
});
