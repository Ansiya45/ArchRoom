import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingDriveFileInspector } from '../src/services/company-recording-drive-file-inspector.js';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';

const expected = { fileId: 'drive_file_123456', destinationId: 'folder_123456789', byteLength: 4,
  mimeType: 'video/webm' as const, sha256: 'a'.repeat(64), companyEmail: 'company@example.com' };
const metadata = { id: expected.fileId, size: '4', mimeType: expected.mimeType, parents: [expected.destinationId],
  trashed: false, sha256Checksum: expected.sha256, ownedByMe: true, version: '7',
  owners: [{ emailAddress: expected.companyEmail }], inheritedPermissionsDisabled: false };
const owner = { id: 'owner_123', type: 'user', role: 'owner', emailAddress: expected.companyEmail };
function inspector(file: Record<string, unknown> = metadata, pages: Record<string, unknown>[] = [{ permissions: [owner] }],
  status = 200) {
  let metadataReads = 0;
  let permissionReads = 0;
  const fetcher = (async (request: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(request));
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.method, 'GET');
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(url.searchParams.get('supportsAllDrives'), 'false');
    if (url.pathname.endsWith('/permissions')) {
      const page = pages[permissionReads++];
      return Response.json(page ?? {}, { status });
    }
    metadataReads++;
    return Response.json(file, { status });
  }) as typeof fetch;
  return { value: new CompanyRecordingDriveFileInspector(fetcher), counts: () => ({ metadataReads, permissionReads }) };
}

test('independently checks exact metadata, SHA-256 and private file permissions', async () => {
  const { value, counts } = inspector();
  const result = await value.inspect('mock-token', expected);
  assert.equal(result.status, 'SAFE');
  assert.deepEqual(counts(), { metadataReads: 2, permissionReads: 1 });
});

test('verified root and SAP MM file checks require the file to report its exact saved parent', async () => {
  for (const destinationId of [recordingDriveRootId(), '1SOsGSLZDpKrQ2OxAbKflTw2LQVZWvx2_']) {
    const target={...expected,destinationId,manualSharing:true};
    assert.equal((await inspector({...metadata,parents:[destinationId]}).value.inspect('mock-token',target)).status,'SAFE');
    assert.equal((await inspector({...metadata,parents:['differentFolder123']}).value.inspect('mock-token',target)).status,'BLOCKED');
    assert.equal((await inspector({...metadata,parents:undefined}).value.inspect('mock-token',target)).status,'UNVERIFIABLE');
  }
});

test('rejects wrong identity, size, MIME, parent, trash and shared drive', async () => {
  for (const change of [
    { id: 'other_file_12345' }, { size: '5' }, { mimeType: 'video/mp4' },
    { parents: ['wrong_folder_123'] }, { trashed: true }, { driveId: 'shared_drive_123' },
    { sha256Checksum: 'b'.repeat(64) },
  ]) {
    const { value } = inspector({ ...metadata, ...change });
    assert.notEqual((await value.inspect('mock-token', expected)).status, 'SAFE', JSON.stringify(change));
  }
});

test('fails closed on missing checksum, inherited-access ambiguity and unavailable metadata', async () => {
  for (const change of [{ sha256Checksum: undefined }, { inheritedPermissionsDisabled: undefined },
    { owners: undefined }, { version: undefined }, { parents: undefined }]) {
    assert.equal((await inspector({ ...metadata, ...change }).value.inspect('mock-token', expected)).status, 'UNVERIFIABLE');
  }
  assert.equal((await inspector(metadata, [{ permissions: [owner] }], 503).value.inspect('mock-token', expected)).status, 'UNVERIFIABLE');
});

test('request diagnostics identify metadata versus permission failures without private responses', async () => {
  const warnings:unknown[][]=[];
  const previous=console.warn;
  console.warn=(...values:unknown[])=>{warnings.push(values);};
  try {
    assert.equal((await inspector(metadata,[{permissions:[owner]}],503).value.inspect('mock-token',expected)).status,'UNVERIFIABLE');
    const fetcher=(async (request:URL|RequestInfo) => new URL(String(request)).pathname.endsWith('/permissions')
      ? new Response('private response', {status:403}) : Response.json(metadata)) as typeof fetch;
    assert.equal((await new CompanyRecordingDriveFileInspector(fetcher).inspect('mock-token',expected)).status,'UNVERIFIABLE');
  } finally {console.warn=previous;}
  assert.deepEqual(warnings.map(([,detail])=>detail),[
    {stage:'metadata_request',kind:'http_failure',httpStatus:503},
    {stage:'permission_list_request',kind:'http_failure',httpStatus:403},
  ]);
  assert.doesNotMatch(JSON.stringify(warnings),/mock-token|private response/);
});

test('rejects public, domain, group and unknown individual access', async () => {
  for (const entry of [
    { id: 'public_1', type: 'anyone', role: 'reader' },
    { id: 'domain_1', type: 'domain', role: 'reader' },
    { id: 'group_1', type: 'group', role: 'reader' },
    { id: 'user_2', type: 'user', role: 'reader', emailAddress: 'other@example.com' },
  ]) assert.equal((await inspector(metadata, [{ permissions: [owner, entry] }]).value.inspect('mock-token', expected)).status, 'BLOCKED');
});

test('manual sharing accepts named users and groups but still rejects public or incomplete permissions', async () => {
  const reader={id:'reader',type:'user',role:'reader',emailAddress:'reader@example.com',permissionDetails:[{inherited:true}]};
  const group={id:'group',type:'group',role:'writer',emailAddress:'team@example.com'};
  const manual={...expected,manualSharing:true};
  assert.equal((await inspector(metadata,[{permissions:[owner,reader,group]}]).value.inspect('mock-token',manual)).status,'SAFE');
  assert.equal((await inspector(metadata,[{permissions:[owner,{id:'public',type:'anyone',role:'reader'}]}]).value.inspect('mock-token',manual)).status,'BLOCKED');
  assert.equal((await inspector(metadata,[{permissions:[owner,{...group,emailAddress:undefined}]}]).value.inspect('mock-token',manual)).status,'UNVERIFIABLE');
  assert.equal((await inspector(metadata,[{permissions:[owner,{...reader,permissionDetails:[{}]}]}]).value.inspect('mock-token',manual)).status,'UNVERIFIABLE');
  assert.notEqual((await inspector(metadata,[{permissions:[owner,reader]}]).value.inspect('mock-token',{...manual,privateReaders:[]})).status,'SAFE');
});

test('handles pagination, incomplete pages and duplicate permissions', async () => {
  assert.equal((await inspector(metadata, [{ permissions: [], nextPageToken: 'next' }, { permissions: [owner] }])
    .value.inspect('mock-token', expected)).status, 'SAFE');
  assert.equal((await inspector(metadata, [{ permissions: [owner], nextPageToken: 'next' }, {}])
    .value.inspect('mock-token', expected)).status, 'UNVERIFIABLE');
  assert.equal((await inspector(metadata, [{ permissions: [owner], nextPageToken: 'next' }, { permissions: [owner] }])
    .value.inspect('mock-token', expected)).status, 'UNVERIFIABLE');
});

test('private inspection requires every verified reader and rejects inherited access', async () => {
  const reader = { userId: 'reader-1', email: 'reader@example.com' };
  const permission = { id: 'reader_permission', type: 'user', role: 'reader', emailAddress: reader.email };
  assert.equal((await inspector(metadata, [{ permissions: [owner, permission] }]).value.inspect('mock-token', { ...expected, privateReaders: [reader] })).status, 'SAFE');
  assert.equal((await inspector(metadata, [{ permissions: [owner] }]).value.inspect('mock-token', { ...expected, privateReaders: [reader] })).status, 'BLOCKED');
  assert.equal((await inspector(metadata, [{ permissions: [owner, { ...permission, inherited: true }] }]).value.inspect('mock-token', { ...expected, privateReaders: [reader] })).status, 'UNVERIFIABLE');
  assert.equal((await inspector(metadata, [{ permissions: [owner, { ...permission, role: 'writer' }] }]).value.inspect('mock-token', { ...expected, privateReaders: [reader] })).status, 'BLOCKED');
});

test('pre-grant inspection allows only missing intended private readers', async () => {
  const reader = { userId: 'reader-1', email: 'reader@example.com' };
  const preflight = { ...expected, privateReaders: [reader], allowMissingPrivateReaders: true };
  assert.equal((await inspector(metadata, [{ permissions: [owner] }]).value.inspect('mock-token', preflight)).status, 'SAFE');
  const unexpected = { id: 'unexpected', type: 'user', role: 'reader', emailAddress: 'other@example.com' };
  assert.equal((await inspector(metadata, [{ permissions: [owner, unexpected] }]).value.inspect('mock-token', preflight)).status, 'BLOCKED');
  assert.equal((await inspector(metadata, [{ permissions: [owner] }]).value.inspect('mock-token', { ...expected, privateReaders: [reader] })).status, 'BLOCKED');
});

test('anyone mode requires exactly one public reader and no other principals', async () => {
  const publicReader = { id:'public-reader', type:'anyone', role:'reader' };
  const sharing = { ...expected, sharingMode:'anyone_with_link' as const };
  assert.equal((await inspector(metadata, [{ permissions:[owner, publicReader] }]).value.inspect('mock-token', sharing)).status, 'SAFE');
  assert.equal((await inspector(metadata, [{ permissions:[owner] }]).value.inspect('mock-token', sharing)).status, 'BLOCKED');
  assert.equal((await inspector(metadata, [{ permissions:[owner, publicReader, { ...publicReader, id:'duplicate' }] }]).value.inspect('mock-token', sharing)).status, 'BLOCKED');
  assert.equal((await inspector(metadata, [{ permissions:[owner, { ...publicReader, role:'writer' }] }]).value.inspect('mock-token', sharing)).status, 'BLOCKED');
});
