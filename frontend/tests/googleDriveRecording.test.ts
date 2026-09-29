import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { driveFolderId, uploadRecordingToDrive, type DriveUpload } from '../src/lib/googleDriveRecording.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const connection = { token: 'test', expiresAt: Date.now() + 60000, accountId: 'test', email: 'test@example.com' };
const recording = { blob: new Blob(['recording']), fileName: 'test.webm', mimeType: 'video/webm' };
const sessionUrl = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test';
test('folder links reject file links and foreign origins', () => {
  assert.equal(driveFolderId('https://drive.google.com/drive/folders/abcdefghijk'), 'abcdefghijk');
  assert.throws(() => driveFolderId('https://example.com/drive/folders/abcdefghijk'));
  assert.throws(() => driveFolderId('https://drive.google.com/file/d/abcdefghijk/view'));
});
test('interrupted upload resumes at the acknowledged byte', async () => {
  const attempt: DriveUpload = { fileId: 'file', sessionUrl };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const headers = options?.headers as Record<string, string>;
    if (calls === 1) {
      assert.equal(headers['Content-Range'], 'bytes */9');
      return new Response(null, { status: 308, headers: { Range: 'bytes=0-3' } });
    }
    assert.equal(headers['Content-Range'], 'bytes 4-8/9');
    assert.equal(await (options?.body as Blob).text(), 'rding');
    return new Response('{}');
  };
  assert.equal(await uploadRecordingToDrive(connection, 'folder', recording, attempt, () => {}), 'https://drive.google.com/file/d/file/view');
  assert.equal(calls, 2);
  assert.equal(attempt.complete, true);
});
test('lost completion response does not upload the file twice', async () => {
  const attempt: DriveUpload = { fileId: 'file', sessionUrl };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  await uploadRecordingToDrive(connection, 'folder', recording, attempt, () => {});
  await uploadRecordingToDrive(connection, 'folder', recording, attempt, () => {});
  assert.equal(calls, 1);
});
test('expired credentials preserve the resumable attempt', async () => {
  const attempt: DriveUpload = { fileId: 'file', sessionUrl };
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  await assert.rejects(uploadRecordingToDrive({ ...connection, expiresAt: 0 }, 'folder', recording, attempt, () => {}), /expired/);
  assert.equal(attempt.sessionUrl, sessionUrl);
});
