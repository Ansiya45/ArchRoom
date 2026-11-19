import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingConfirmationService } from '../src/services/company-recording-confirmation.service.js';

const recording = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
const row = { job_id: '33333333-3333-4333-8333-333333333333', recording_id: recording,
  owner_user_id: owner, meeting_id: '44444444-4444-4444-8444-444444444444', occurrence_id: null,
  verified_drive_file_id: 'file1234567890', destination_folder_id: 'folder1234567890', byte_length: '123',
  sha256: 'a'.repeat(64), mime_type: 'video/webm', history_id: '55555555-5555-4555-8555-555555555555',
  history_url: 'https://drive.google.com/file/d/file1234567890/view' };
const job = { recordingId: recording, meetingId: row.meeting_id, occurrenceId: null };

test('confirmation requires a persisted match and repeats the read after authorization', async () => {
  let calls = 0;
  const sql = async (_parts: TemplateStringsArray, id: string, user: string) => {
    calls++; assert.equal(id, recording); assert.equal(user, owner); return [{ ...row }];
  };
  const service = new CompanyRecordingConfirmationService(sql as any, async (id, user) => {
    assert.equal(id, row.job_id); assert.equal(user, owner); return job;
  });
  const result = await service.confirm(recording, owner);
  assert.equal(calls, 2); assert.equal(result?.verified, true); assert.equal(result?.historyUrl, row.history_url);
  assert.equal(result?.destinationFolderId, row.destination_folder_id); assert.equal(result?.byteLength, 123);
});

test('confirmation fails closed on missing, unauthorized, invalid or changing evidence', async () => {
  const absent = new CompanyRecordingConfirmationService((async () => []) as any, async () => { throw new Error('must not authorize'); });
  assert.equal(await absent.confirm(recording, owner), null);
  for (const change of [{ owner_user_id: 'wrong' }, { recording_id: 'wrong' }, { history_url: 'https://example.invalid/' },
    { destination_folder_id: '' }, { verified_drive_file_id: '' }, { sha256: 'bad' }, { byte_length: '0' }]) {
    const service = new CompanyRecordingConfirmationService((async () => [{ ...row, ...change }]) as any, async () => job);
    assert.equal(await service.confirm(recording, owner), null);
  }
  for (const altered of [{ ...job, meetingId: 'wrong' }, { ...job, occurrenceId: 'wrong' }, { ...job, recordingId: 'wrong' }]) {
    const service = new CompanyRecordingConfirmationService((async () => [{ ...row }]) as any, async () => altered);
    assert.equal(await service.confirm(recording, owner), null);
  }
  let calls = 0;
  const changing = new CompanyRecordingConfirmationService((async () => [{ ...row, history_id: ++calls === 1 ? row.history_id : 'different' }]) as any, async () => job);
  assert.equal(await changing.confirm(recording, owner), null);
  const unauthorized = new CompanyRecordingConfirmationService((async () => [{ ...row }]) as any, async () => { throw new Error('forbidden'); });
  await assert.rejects(unauthorized.confirm(recording, owner), /forbidden/);
});
