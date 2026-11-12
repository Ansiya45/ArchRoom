import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { memoryCredentialRepository } from './drive-credential-memory.js';
import { IntegrationCredentialService } from '../src/services/drive-security.service.js';
import { CompanyDrivePrivacyInspector, RecordingDestinationPrivacyService } from '../src/services/recording-destination-privacy.service.js';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';
import type { OAuthTransport } from '../src/services/google-drive-oauth.service.js';

const admin = '11111111-1111-4111-8111-111111111111';
const config = { clientId: 'mock', clientSecret: 'mock', callbackUrl: 'https://example.invalid/google-drive/oauth/callback', administratorId: admin };
const root = recordingDriveRootId(); const myRoot = 'privateAccountRoot123'; const child = 'batchFolder123';
const mime = 'application/vnd.google-apps.folder';
const valid = (id: string, parents: string[]) => ({ id, mimeType: mime, trashed: false, parents, version: '1', ownedByMe: true,
  isAppAuthorized: true, capabilities: { canAddChildren: true, canListChildren: true, canShare: true } });
const owner = { id: 'owner-permission', type: 'user', role: 'owner', emailAddress: 'company@example.invalid' };

async function setup() {
  const memory = memoryCredentialRepository();
  const credentials = new IntegrationCredentialService(memory.repository, admin, randomBytes(32));
  await credentials.replace(admin, 'company@example.invalid', 'mock-refresh', await credentials.generation());
  const transport: OAuthTransport = { exchangeCode: async () => ({}), refresh: async () => ({ access_token: 'mock-access' }),
    accountEmail: async () => 'company@example.invalid', rootMetadata: async () => valid(root, [myRoot]) };
  const folders = new Map<string, any>([['root', valid(myRoot, [])], [root, valid(root, [myRoot])], [child, valid(child, [root])]]);
  const acl = new Map<string, any>([[myRoot, { permissions: [owner] }], [root, { permissions: [owner] }], [child, { permissions: [owner] }]]);
  const calls: string[] = [];
  let handler: ((url: URL) => Promise<Response>) | undefined;
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); calls.push(url.toString());
    if (handler) return handler(url);
    const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/);
    if (!match) throw new Error('Unexpected request');
    return new Response(JSON.stringify(match[2] ? acl.get(match[1]) : folders.get(match[1])), { status: 200 });
  };
  const inspector = new CompanyDrivePrivacyInspector(config, transport, credentials, fetcher);
  let selected: string | null = null, authorized = true, folderAllowed = true;
  const service = new RecordingDestinationPrivacyService({
    authorize: async () => { if (!authorized) throw new Error('private internal failure'); return { recordingFolderId: selected }; },
    mayUseFolder: async () => folderAllowed,
    inspect: (rootId, folderId, allowNamedSharing) => inspector.inspect(rootId, folderId, allowNamedSharing),
  });
  return { service, inspector, credentials, transport, folders, acl, calls, setSelected: (value: string | null) => { selected = value; },
    setAuthorized: (value: boolean) => { authorized = value; }, setFolderAllowed: (value: boolean) => { folderAllowed = value; }, setHandler: (value: typeof handler) => { handler = value; } };
}
const validate = (ctx: Awaited<ReturnType<typeof setup>>) => ctx.service.validateImmediatelyBeforeFileCreation({ meetingCode: 'YLM-ABC234' }, admin);

test('company uploads use only the verified root even when a meeting has a saved batch', async () => {
  const ctx = await setup(); ctx.setSelected(child);
  const result = await ctx.service.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin);
  assert.equal(result.status,'SAFE'); if (result.status === 'SAFE') assert.equal(result.destinationId,root);
  assert.ok(ctx.calls.every(call => !call.includes(child)));
  assert.ok(ctx.calls.every(call => !call.includes('upload')));
  ctx.folders.set(root, {...valid(root,[myRoot]),trashed:true});
  assert.notEqual((await ctx.service.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin)).status,'SAFE');
});

test('company root verification fails closed on mismatched destination or credentials', async () => {
  const svc = new RecordingDestinationPrivacyService({authorize:async()=>({recordingFolderId:child}),mayUseFolder:async()=>true,
    inspect:async()=>({status:'SAFE',destinationId:child,checkedAt:'test',confirmCurrent:async()=>true})});
  assert.equal((await svc.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin)).status,'UNVERIFIABLE');
});

test('company root allows existing named users and groups while rejecting public access', async () => {
  const ctx=await setup();
  ctx.acl.set(root,{permissions:[owner,{id:'reader',type:'user',role:'reader',emailAddress:'reader@example.invalid'},{id:'group',type:'group',role:'writer',emailAddress:'team@example.invalid'}]});
  const result=await ctx.service.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin);
  assert.equal(result.status,'SAFE');
  assert.ok(ctx.calls.every(call=>!call.includes('upload')));
  ctx.acl.set(root,{permissions:[owner,{id:'public',type:'anyone',role:'reader'}]});
  assert.equal((await ctx.service.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin)).status,'BLOCKED');
  ctx.acl.set(root,{permissions:[owner,{id:'group',type:'group',role:'reader'}]});
  assert.equal((await ctx.service.validateCompanyRoot({meetingCode:'YLM-ABC234'},admin)).status,'UNVERIFIABLE');
});

test('a configured folder shared with the connected account as Editor is a valid destination', async () => {
  const ctx = await setup();
  const companyOwner = { id: 'company-owner', type: 'user', role: 'owner', emailAddress: 'folder-owner@example.invalid' };
  const editor = { id: 'company-editor', type: 'user', role: 'writer', emailAddress: 'company@example.invalid' };
  const sharedRoot = { ...valid(root, ['ownerDriveRoot123']), ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } };
  ctx.folders.set(root, sharedRoot);
  ctx.acl.set(root, { permissions: [companyOwner, editor] });
  assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'SAFE');
  assert.ok(ctx.calls.every(call => !call.includes(myRoot)));

  ctx.setSelected(child);
  ctx.folders.set(child, { ...valid(child, [root]), ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } });
  ctx.acl.set(child, { permissions: [companyOwner, editor] });
  assert.equal((await validate(ctx)).status, 'SAFE');

  ctx.folders.set(root, { ...sharedRoot, capabilities: { ...sharedRoot.capabilities, canAddChildren: false } });
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, sharedRoot);
  ctx.acl.set(root, { permissions: [companyOwner, editor, { id: 'public', type: 'anyone', role: 'reader' }] });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
  ctx.acl.set(root, { permissions: [editor] });
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  assert.equal((await ctx.inspector.inspect(root, null, false)).status, 'UNVERIFIABLE');
});

test('configured shared root accepts omitted owner-parent metadata only after its own authorization and ACL checks', async () => {
  const ctx = await setup();
  const companyOwner = { id: 'company-owner', type: 'user', role: 'owner', emailAddress: 'folder-owner@example.invalid' };
  const editor = { id: 'company-editor', type: 'user', role: 'writer', emailAddress: 'company@example.invalid' };
  const sharedRoot = { ...valid(root, [myRoot]), parents: undefined, ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } };
  ctx.folders.set(root, sharedRoot);
  ctx.acl.set(root, { permissions: [companyOwner, editor] });
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'SAFE');
  } finally { console.warn = originalWarn; }
  const diagnostic = warnings.find(([event]) => event === 'Company recording root ancestry metadata')?.[1];
  assert.deepEqual(diagnostic, { parentsFieldPresent: false, parentCount: null, ownedByMe: 'no',
    appAuthorized: true, canListChildren: true, canAddChildren: true });
  assert.doesNotMatch(JSON.stringify(warnings), /ownerDriveRoot123|mock-access|mock-refresh/);
  assert.ok(ctx.calls.some(call => call.includes(`/files/${root}?`) && new URL(call).searchParams.get('fields')?.includes('parents')));
  assert.ok(ctx.calls.every(call => !call.includes('/files/root?')));

  ctx.acl.set(root, { permissions: [companyOwner, editor, { id: 'public', type: 'anyone', role: 'reader' }] });
  assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'BLOCKED');
  ctx.acl.set(root, { permissions: [companyOwner, editor] });
  ctx.folders.set(root, { ...sharedRoot, isAppAuthorized: false });
  assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, { ...sharedRoot, capabilities: { ...sharedRoot.capabilities, canAddChildren: false } });
  assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, { ...sharedRoot, parents: [] });
  const emptyParentWarnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { emptyParentWarnings.push(args); };
  try {
    assert.equal((await ctx.service.validateCompanyRoot({ meetingCode: 'YLM-ABC234' }, admin)).status, 'BLOCKED');
  } finally { console.warn = originalWarn; }
  assert.equal((emptyParentWarnings.find(([event]) => event === 'Company recording root ancestry metadata')?.[1] as { parentCount?: number })?.parentCount, 0);
});

test('shared root with omitted parent still requires the child to report the exact configured root', async () => {
  const ctx = await setup();
  const companyOwner = { id: 'company-owner', type: 'user', role: 'owner', emailAddress: 'folder-owner@example.invalid' };
  const editor = { id: 'company-editor', type: 'user', role: 'writer', emailAddress: 'company@example.invalid' };
  ctx.folders.set(root, { ...valid(root, [myRoot]), parents: undefined, ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } });
  ctx.acl.set(root, { permissions: [companyOwner, editor] });
  ctx.setSelected(child);
  ctx.folders.set(child, { ...valid(child, [root]), ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } });
  ctx.acl.set(child, { permissions: [companyOwner, editor] });
  assert.equal((await validate(ctx)).status, 'SAFE');
  assert.ok(ctx.calls.some(call => call.includes(`/files/${child}?`) && new URL(call).searchParams.get('fields')?.includes('parents')));
  ctx.folders.set(child, { ...valid(child, ['differentParent123']), ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
  ctx.folders.set(child, { ...valid(child, [root]), parents: undefined, ownedByMe: false,
    capabilities: { canAddChildren: true, canListChildren: true, canShare: false } });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
});

test('private root and direct-child destination come only from authorized meeting settings', async () => {
  const ctx = await setup(); const rootResult = await validate(ctx);
  assert.equal(rootResult.status, 'SAFE'); if (rootResult.status === 'SAFE') assert.equal(rootResult.destinationId, root);
  ctx.setSelected(child); const childResult = await validate(ctx);
  assert.equal(childResult.status, 'SAFE'); if (childResult.status === 'SAFE') assert.equal(childResult.destinationId, child);
  assert.ok(ctx.calls.every(value => !value.includes('upload')));
});

test('a durable upload job can revalidate its exact authorized destination without changing meeting settings', async () => {
  const ctx = await setup();
  const result = await ctx.service.validateJobDestinationImmediatelyBeforeFileCreation({ meetingCode: 'YLM-ABC234' }, admin, child);
  assert.equal(result.status, 'SAFE');
  if (result.status === 'SAFE') assert.equal(result.destinationId, child);
});

test('instant and scheduled occurrence inputs are passed to host authorization before inspection', async () => {
  const calls: unknown[] = [];
  const svc = new RecordingDestinationPrivacyService({ authorize: async (...args) => { calls.push(args); return { recordingFolderId: null }; },
    mayUseFolder: async () => { throw new Error('unused'); }, inspect: async id => ({ status: 'SAFE', destinationId: id, checkedAt: 'test', confirmCurrent: async () => true }) });
  await svc.validateImmediatelyBeforeFileCreation({ meetingCode: 'instant' }, admin);
  await svc.validateImmediatelyBeforeFileCreation({ meetingCode: 'scheduled', occurrenceId: 'session' }, admin);
  assert.deepEqual(calls, [['instant', undefined, admin], ['instant', undefined, admin], ['scheduled', 'session', admin], ['scheduled', 'session', admin]]);
});

test('meeting destination or authorization changed during verification is rejected', async () => {
  let count = 0;
  const svc = new RecordingDestinationPrivacyService({
    authorize: async () => ({ recordingFolderId: ++count === 1 ? null : child }),
    mayUseFolder: async () => true,
    inspect: async id => ({ status: 'SAFE', destinationId: id, checkedAt: 'test', confirmCurrent: async () => true }),
  });
  assert.equal((await svc.validateImmediatelyBeforeFileCreation({ meetingCode: 'instant' }, admin)).status, 'UNVERIFIABLE');
});

test('unauthorized host or folder does not contact Drive', async () => {
  const ctx = await setup(); ctx.setAuthorized(false); assert.equal((await validate(ctx)).status, 'BLOCKED'); assert.equal(ctx.calls.length, 0);
  ctx.setAuthorized(true); ctx.setSelected(child); ctx.setFolderAllowed(false); assert.equal((await validate(ctx)).status, 'BLOCKED'); assert.equal(ctx.calls.length, 0);
});

for (const permission of [
  { id: 'public', type: 'anyone', role: 'reader' },
  { id: 'domain', type: 'domain', role: 'reader' },
]) test(`rejects ${permission.type} access on destination or ancestor`, async () => {
  const ctx = await setup(); ctx.acl.set(myRoot, { permissions: [owner, permission] });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
});

test('checks inherited ancestor access and rejects moved or trashed folders', async () => {
  const ctx = await setup(); ctx.setSelected(child);
  ctx.acl.set(root, { permissions: [owner, { id: 'student', type: 'user', role: 'reader', emailAddress: 'student@example.invalid' }] });
  assert.equal((await validate(ctx)).status, 'SAFE');
  ctx.acl.set(root, { permissions: [owner] }); ctx.folders.set(child, valid(child, ['otherParent123']));
  assert.equal((await validate(ctx)).status, 'BLOCKED');
  ctx.folders.set(child, valid(child, [root])); ctx.folders.set(root, valid(root, ['otherParent123']));
  assert.equal((await validate(ctx)).status, 'BLOCKED');
  ctx.folders.set(root, { ...valid(root, [myRoot]), trashed: true });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
});

test('shared drives, missing ownership and missing ancestors fail closed', async () => {
  const ctx = await setup();
  ctx.folders.set(root, { ...valid(root, [myRoot]), driveId: 'shared-drive' }); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, { ...valid(root, [myRoot]), ownedByMe: undefined }); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, { ...valid(root, [myRoot]), parents: undefined }); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  ctx.folders.set(root, valid(root, [myRoot])); ctx.acl.set(root, {}); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
});

test('permission pagination is complete and fails closed on errors or repeated tokens', async () => {
  const ctx = await setup();
  ctx.setHandler(async url => {
    const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/)!; const id = match[1];
    if (!match[2]) return new Response(JSON.stringify(ctx.folders.get(id)));
    if (id === root && !url.searchParams.get('pageToken')) return new Response(JSON.stringify({ permissions: [], nextPageToken: 'next' }));
    return new Response(JSON.stringify({ permissions: [owner] }));
  });
  assert.equal((await validate(ctx)).status, 'SAFE');
  ctx.setHandler(async url => {
    const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/)!; const id = match[1];
    if (!match[2]) return new Response(JSON.stringify(ctx.folders.get(id)));
    if (id === root && !url.searchParams.get('pageToken')) return new Response(JSON.stringify({ permissions: [owner], nextPageToken: 'next' }));
    if (id === root) return new Response(JSON.stringify({ permissions: [{ id: 'public', type: 'anyone', role: 'reader' }] }));
    return new Response(JSON.stringify({ permissions: [owner] }));
  });
  assert.equal((await validate(ctx)).status, 'BLOCKED');
  ctx.setHandler(async url => {
    const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/)!;
    return new Response(JSON.stringify(match[2] ? { permissions: [owner], nextPageToken: 'repeated' } : ctx.folders.get(match[1])));
  });
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  ctx.setHandler(async () => new Response('', { status: 403 })); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
});

test('destination diagnostics distinguish a permission API failure from a rejected root capability', async () => {
  const ctx = await setup();
  const logs: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    ctx.setHandler(async url => {
      const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/)!;
      return match[2]
        ? new Response('private provider response', { status: 403 })
        : new Response(JSON.stringify(ctx.folders.get(match[1])));
    });
    assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
    assert.ok(logs.some(([event, detail]) => event === 'Company recording destination inspection exception' &&
      (detail as { stage?: string; kind?: string; httpStatus?: number }).stage === 'permission_list_request' &&
      (detail as { kind?: string }).kind === 'request_failure' &&
      (detail as { httpStatus?: number }).httpStatus === 403));
    assert.doesNotMatch(JSON.stringify(logs), /private provider response/);

    logs.length = 0;
    ctx.setHandler(undefined);
    ctx.folders.set(root, { ...valid(root, [myRoot]), isAppAuthorized: false });
    assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
    assert.ok(logs.some(([event, detail]) => event === 'Company recording destination validation' &&
      (detail as { reason?: string }).reason === 'The recording root is not authorized for this application.'));
    assert.ok(!logs.some(([event]) => event === 'Company recording destination inspection exception'));
  } finally { console.warn = originalWarn; }
});

test('folder metadata changing during the permission scan is not accepted', async () => {
  const ctx = await setup();
  ctx.setHandler(async url => {
    const match = url.pathname.match(/\/files\/([^/]+)(\/permissions)?$/)!;
    if (match[2]) {
      if (match[1] === root) ctx.folders.set(root, { ...valid(root, [myRoot]), version: '2' });
      return new Response(JSON.stringify({ permissions: [owner] }));
    }
    return new Response(JSON.stringify(ctx.folders.get(match[1])));
  });
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
});

test('disconnected or concurrently changed credentials cannot result in SAFE', async () => {
  const ctx = await setup(); await ctx.credentials.disconnect(admin); assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  await ctx.credentials.replace(admin, 'company@example.invalid', 'refresh', await ctx.credentials.generation());
  const original = ctx.transport.rootMetadata;
  ctx.transport.rootMetadata = async (...args) => { await ctx.credentials.disconnect(admin); return original(...args); };
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
  await ctx.credentials.replace(admin, 'company@example.invalid', 'refresh', await ctx.credentials.generation());
  ctx.transport.rootMetadata = async (...args) => { await ctx.credentials.replace(admin, 'company@example.invalid', 'replacement', await ctx.credentials.generation()); return original(...args); };
  assert.equal((await validate(ctx)).status, 'UNVERIFIABLE');
});

test('disconnect during the final host authorization cannot return SAFE', async () => {
  const ctx = await setup(); let calls = 0;
  const service = new RecordingDestinationPrivacyService({
    authorize: async () => { if (++calls === 2) await ctx.credentials.disconnect(admin); return { recordingFolderId: null }; },
    mayUseFolder: async () => true,
    inspect: (rootId, folderId) => ctx.inspector.inspect(rootId, folderId),
  });
  assert.equal((await service.validateImmediatelyBeforeFileCreation({ meetingCode: 'YLM-ABC234' }, admin)).status, 'UNVERIFIABLE');
});
