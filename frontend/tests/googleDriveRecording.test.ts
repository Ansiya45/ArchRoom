import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { driveFolderId, resolveDriveFolder, uploadRecordingToDrive, type DriveUpload } from '../src/lib/googleDriveRecording.ts';
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

const folderLink = 'https://drive.google.com/drive/folders/abcdefghijk';
const folderResponse = () => Response.json({ id: 'abcdefghijk', name: 'Recordings', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } });
test('previously authorized folder links do not prompt for selection', async () => {
  globalThis.fetch = async () => folderResponse();
  const folder = await resolveDriveFolder(connection, folderLink, async () => { throw new Error('Picker should not open'); });
  assert.equal(folder.id, 'abcdefghijk');
});
test('first-time folder access continues after matching picker selection', async () => {
  let requests = 0, selections = 0;
  globalThis.fetch = async () => ++requests === 1 ? new Response(null, { status: 404 }) : folderResponse();
  const folder = await resolveDriveFolder(connection, folderLink, async () => { selections++; return { id: 'abcdefghijk', name: 'Recordings' }; });
  assert.equal(folder.name, 'Recordings');
  assert.equal(requests, 2);
  assert.equal(selections, 1);
});
test('cancelled or mismatched folder selection cannot redirect an upload', async () => {
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(resolveDriveFolder(connection, folderLink, async () => null), /cancelled/);
  await assert.rejects(resolveDriveFolder(connection, folderLink, async () => ({ id: 'different', name: 'Other' })), /does not match/);
});
test('read-only folders and server errors do not trigger the permission picker', async () => {
  const select = async () => { throw new Error('Picker should not open'); };
  globalThis.fetch = async () => Response.json({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: false } });
  await assert.rejects(resolveDriveFolder(connection, folderLink, select), /can upload files/);
  globalThis.fetch = async () => new Response(null, { status: 500 });
  await assert.rejects(resolveDriveFolder(connection, folderLink, select), /500/);
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
