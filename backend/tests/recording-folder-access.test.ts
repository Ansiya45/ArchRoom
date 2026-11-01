import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DOTENV_CONFIG_PATH = 'tests/.unused-stage-c1-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'stage-c1-test-secret';
delete process.env.GOOGLE_INTEGRATION_ADMIN_USER_ID;
const { recordingDriveRootId } = await import('../src/config/recordingDrive.js');
const { createRecordingFolder, listRecordingFolders, validateRecordingDestination } = await import('../src/services/recording-folder-access.service.js');

test('unconfigured backend never lists fabricated Drive folders or creates one', async () => {
  assert.deepEqual(await listRecordingFolders('ordinary-user'), { connected: false, canCreate: false, folders: [] });
  await assert.rejects(createRecordingFolder('ordinary-user', 'SAP MM'), { code: 'FORBIDDEN' });
});

test('central root remains NULL, while unverified child selection fails closed', async () => {
  assert.equal(await validateRecordingDestination('ordinary-user', null), null);
  assert.equal(await validateRecordingDestination('ordinary-user', recordingDriveRootId()), null);
  await assert.rejects(validateRecordingDestination('ordinary-user', 'unverified-folder'), { code: 'BAD_REQUEST' });
});
