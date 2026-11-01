import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';

const administratorId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const ordinaryId = '33333333-3333-4333-8333-333333333333';
process.env.DOTENV_CONFIG_PATH = 'tests/.unused-stage-c11-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'stage-c11-test-secret';
process.env.GOOGLE_INTEGRATION_ADMIN_USER_ID = administratorId;
const { db } = await import('../src/db/index.js');
const { recordingBatchFolders, recordingBatchFolderPermissions, recordingFolderCreators } = await import('../src/db/schema.js');
const { assertIntegrationAdministrator, canCreateRecordingFolder, setRecordingFolderCreatorGrant } = await import('../src/services/drive-security.service.js');
const { createRecordingFolder, listRecordingFolders } = await import('../src/services/recording-folder-access.service.js');
const { recordingDriveRootId } = await import('../src/config/recordingDrive.js');
const { googleDriveIntegrationRouter } = await import('../src/routers/google-drive-integration.js');

function withGrant(grantedUserId: string | null, run: () => Promise<void>) {
  const original = db.query.recordingFolderCreators.findFirst;
  db.query.recordingFolderCreators.findFirst = (async ({ where }: any) =>
    new PgDialect().sqlToQuery(where).params.includes(grantedUserId) ? { userId: grantedUserId } : undefined) as typeof original;
  return run().finally(() => { db.query.recordingFolderCreators.findFirst = original; });
}

test('explicit creator grant is separate from OAuth administration and per-folder manager roles', async () => {
  await withGrant(managerId, async () => {
    assert.equal(await canCreateRecordingFolder(administratorId, administratorId), true);
    assert.equal(await canCreateRecordingFolder(managerId, administratorId), true);
    assert.equal(await canCreateRecordingFolder(ordinaryId, administratorId), false);
    assert.throws(() => assertIntegrationAdministrator(managerId, administratorId), { code: 'FORBIDDEN' });
  });
  await withGrant(null, async () => {
    assert.equal(await canCreateRecordingFolder(managerId, administratorId), false);
    await assert.rejects(createRecordingFolder(managerId, 'Protected batch'), { code: 'FORBIDDEN' });
    await assert.rejects(createRecordingFolder(ordinaryId, 'Protected batch'), { code: 'FORBIDDEN' });
  });
});

test('an explicitly granted batch manager creates one root child and receives only its manager assignment', async () => {
  const originalQuery = db.query.recordingFolderCreators.findFirst;
  const originalTransaction = db.transaction;
  const writes: Array<{ table: unknown; value: any }> = [];
  db.query.recordingFolderCreators.findFirst = (async ({ where }: any) =>
    new PgDialect().sqlToQuery(where).params.includes(managerId) ? { userId: managerId } : undefined) as typeof originalQuery;
  db.transaction = (async (callback: any) => callback({ insert: (table: unknown) => ({ values: async (value: any) => { writes.push({ table, value }); } }) })) as typeof originalTransaction;
  const drive = {
    listDirectChildren: async () => [],
    createDirectChild: async (name: string) => ({ id: 'mock-batch-folder-01', name,
      mimeType: 'application/vnd.google-apps.folder', parents: [recordingDriveRootId()], trashed: false }),
  };
  try {
    const result = await createRecordingFolder(managerId, 'SAP MM', drive);
    assert.deepEqual(result, { id: 'mock-batch-folder-01', name: 'SAP MM' });
    assert.equal(writes.length, 2);
    assert.equal(writes[0].table, recordingBatchFolders);
    assert.deepEqual(writes[0].value, { folderId: result.id, name: result.name, createdByUserId: managerId });
    assert.equal(writes[1].table, recordingBatchFolderPermissions);
    assert.deepEqual(writes[1].value, { folderId: result.id, userId: managerId, role: 'manager' });
    const adminCreated = await createRecordingFolder(administratorId, 'SAP FICO', drive);
    assert.equal(adminCreated.name, 'SAP FICO');
    assert.equal(writes[3].value.userId, administratorId);
    await assert.rejects(createRecordingFolder(managerId, 'SAP MM', { ...drive,
      listDirectChildren: async () => [{ id: result.id, name: 'SAP MM', mimeType: 'application/vnd.google-apps.folder' }],
    }), { code: 'CONFLICT' });
  } finally { db.query.recordingFolderCreators.findFirst = originalQuery; db.transaction = originalTransaction; }
});

test('connected listing exposes creation control only to administrator or explicitly granted manager', async () => {
  const originalSelect = db.select;
  db.select = (() => ({ from: async () => [] })) as typeof originalSelect;
  const drive = { listDirectChildren: async () => [], createDirectChild: async () => { throw new Error('Unexpected create'); } };
  try {
    await withGrant(managerId, async () => {
      assert.equal((await listRecordingFolders(administratorId, drive)).canCreate, true);
      assert.equal((await listRecordingFolders(managerId, drive)).canCreate, true);
      assert.equal((await listRecordingFolders(ordinaryId, drive)).canCreate, false);
    });
  } finally { db.select = originalSelect; }
});

test('Drive creation followed by registration failure reports the orphan for reconciliation', async () => {
  const originalTransaction = db.transaction;
  const originalError = console.error;
  const errors: string[] = [];
  db.transaction = (async () => { throw new Error('synthetic database failure with private detail'); }) as typeof originalTransaction;
  console.error = (message: string) => { errors.push(message); };
  const drive = {
    listDirectChildren: async () => [],
    createDirectChild: async (name: string) => ({ id: 'orphan-folder-01', name,
      mimeType: 'application/vnd.google-apps.folder', parents: [recordingDriveRootId()], trashed: false }),
  };
  try {
    await assert.rejects(createRecordingFolder(administratorId, 'SAP MM', drive), (error: any) =>
      error.code === 'INTERNAL_SERVER_ERROR' && error.message.includes('orphan-folder-01') &&
      error.message.includes('Do not retry') && !error.message.includes('private detail'));
    assert.deepEqual(errors.map(JSON.parse), [{ event: 'recording_folder_registration_failed', folderId: 'orphan-folder-01' }]);
  } finally { db.transaction = originalTransaction; console.error = originalError; }
});

test('only integration administrator can grant or revoke creator permission', async () => {
  const originalInsert = db.insert;
  const originalDelete = db.delete;
  const writes: Array<{ table: unknown; value?: any }> = [];
  db.insert = ((table: unknown) => ({ values: (value: any) => ({ onConflictDoNothing: async () => { writes.push({ table, value }); } }) })) as typeof originalInsert;
  db.delete = ((table: unknown) => ({ where: async () => { writes.push({ table }); } })) as typeof originalDelete;
  try {
    await assert.rejects(setRecordingFolderCreatorGrant(administratorId, managerId, ordinaryId, true), { code: 'FORBIDDEN' });
    await assert.rejects(setRecordingFolderCreatorGrant(undefined, administratorId, ordinaryId, true), { code: 'FORBIDDEN' });
    assert.equal(writes.length, 0);
    await setRecordingFolderCreatorGrant(administratorId, administratorId, managerId, true);
    await setRecordingFolderCreatorGrant(administratorId, administratorId, managerId, false);
    assert.deepEqual(writes.map(write => write.table), [recordingFolderCreators, recordingFolderCreators]);
  } finally { db.insert = originalInsert; db.delete = originalDelete; }
});

test('batch creator cannot start, replace, verify, or disconnect the Google integration', async () => {
  const caller = googleDriveIntegrationRouter.createCaller({ isAuthenticated: true, user: { id: managerId } } as never);
  await assert.rejects(caller.start(), { code: 'FORBIDDEN' });
  await assert.rejects(caller.pickerAccess(), { code: 'FORBIDDEN' });
  await assert.rejects(caller.verifyRoot({ selectedFolderId: recordingDriveRootId() }), { code: 'FORBIDDEN' });
  await assert.rejects(caller.disconnect(), { code: 'FORBIDDEN' });
});
