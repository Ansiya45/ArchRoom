import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECORDINGS_DRIVE_FOLDER_URL, folderIdFromDriveUrl, recordingDriveRootId } from '../src/config/recordingDrive.js';
import { RecordingDriveFolderService, type DriveFolder, type RecordingDriveFolderClient } from '../src/services/recording-drive-folder.service.js';

const rootId = recordingDriveRootId();
const folder = (id: string, name: string, parents = [rootId], extra: Partial<DriveFolder> = {}): DriveFolder =>
  ({ id, name, parents, mimeType: 'application/vnd.google-apps.folder', ...extra });
const root = folder(rootId, 'Recording Sessions', [], { capabilities: { canAddChildren: true } });

function mockClient(overrides: Partial<RecordingDriveFolderClient> = {}): RecordingDriveFolderClient {
  return {
    listChildren: async () => ({ files: [] }),
    getFolder: async id => id === rootId ? root : null,
    createFolder: async (parentId, name) => folder('createdFolder123', name, [parentId]),
    ...overrides,
  };
}

test('configured root URL is valid and extracted without exposing a second configured ID', () => {
  assert.equal(folderIdFromDriveUrl(RECORDINGS_DRIVE_FOLDER_URL), rootId);
  assert.equal(folderIdFromDriveUrl(`${RECORDINGS_DRIVE_FOLDER_URL}?usp=sharing`), rootId);
});

test('rejects invalid URLs, hosts, folder IDs and unsupported URL formats', () => {
  for (const url of [
    'not-a-url', 'http://drive.google.com/drive/folders/validFolder123',
    'https://drive.google.com.evil.test/drive/folders/validFolder123',
    'https://user:secret@drive.google.com/drive/folders/validFolder123',
    'https://drive.google.com/drive/folders/short',
    'https://drive.google.com/drive/folders/validFolder123/other',
    'https://drive.google.com/file/d/validFolder123/view',
    'https://drive.google.com/drive/folders/validFolder123?bad=1',
  ]) assert.throws(() => folderIdFromDriveUrl(url));
});

test('lists paginated direct children with immutable IDs and keeps duplicate names', async () => {
  const calls: Array<string | undefined> = [];
  const client = mockClient({ listChildren: async (parent, page) => {
    assert.equal(parent, rootId); calls.push(page);
    return page ? { files: [folder('childFolder222', 'SAP MM'), folder('foreignFolder12', 'Other', ['foreignRoot12'])] }
      : { files: [folder('childFolder111', 'SAP MM'), folder('trashedFolder1', 'Deleted', [rootId], { trashed: true })], nextPageToken: 'next' };
  } });
  const found = await new RecordingDriveFolderService(client).listDirectChildren();
  assert.deepEqual(found.map(f => [f.id, f.name]), [['childFolder111', 'SAP MM'], ['childFolder222', 'SAP MM']]);
  assert.deepEqual(calls, [undefined, 'next']);
});

test('a refreshed listing returns renamed folders without caching names', async () => {
  let name = 'Old name';
  const service = new RecordingDriveFolderService(mockClient({ listChildren: async () => ({ files: [folder('childFolder111', name)] }) }));
  assert.equal((await service.listDirectChildren())[0].name, 'Old name');
  name = 'New name';
  assert.equal((await service.listDirectChildren())[0].name, 'New name');
});

test('creates only under configured root and validates returned parent', async () => {
  let parent = '';
  const service = new RecordingDriveFolderService(mockClient({ createFolder: async (id, name) => {
    parent = id; return folder('createdFolder123', name, [id]);
  } }));
  assert.equal((await service.createDirectChild('  Python Training  ')).name, 'Python Training');
  assert.equal(parent, rootId);
  await assert.rejects(() => service.createDirectChild(' / '));
  await assert.rejects(() => new RecordingDriveFolderService(mockClient({ createFolder: async () => folder('createdFolder123', 'Wrong', ['foreignRoot12']) })).createDirectChild('Wrong'));
});

test('validates root or direct child; rejects deleted, inaccessible and foreign folders', async () => {
  const service = new RecordingDriveFolderService(mockClient({ getFolder: async id => ({
    [rootId]: root,
    childFolder111: folder('childFolder111', 'Class'),
    deletedFolder1: folder('deletedFolder1', 'Deleted', [rootId], { trashed: true }),
    foreignFolder1: folder('foreignFolder1', 'Outside', ['foreignRoot12']),
  } as Record<string, DriveFolder>)[id] ?? null }));
  assert.equal((await service.validateDestination(rootId)).id, rootId);
  assert.equal((await service.validateDestination('childFolder111')).id, 'childFolder111');
  for (const id of ['deletedFolder1', 'foreignFolder1', 'missingFolder1', 'bad']) await assert.rejects(() => service.validateDestination(id));
});

test('missing client, inaccessible root, API errors and repeated pages fail clearly', async () => {
  await assert.rejects(() => new RecordingDriveFolderService().listDirectChildren(), /not configured/);
  await assert.rejects(() => new RecordingDriveFolderService(mockClient({ getFolder: async () => null })).listDirectChildren(), /root folder/);
  await assert.rejects(() => new RecordingDriveFolderService(mockClient({ listChildren: async () => { throw new Error('Google unavailable'); } })).listDirectChildren(), /Google unavailable/);
  await assert.rejects(() => new RecordingDriveFolderService(mockClient({ listChildren: async () => ({ files: [], nextPageToken: 'same' }) })).listDirectChildren(), /repeated folder page/);
});
