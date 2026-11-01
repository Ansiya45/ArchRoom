import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';
import { BackendRecordingDriveClient } from '../src/services/backend-recording-drive-client.js';
import { IntegrationCredentialService, type IntegrationCredentialRepository } from '../src/services/drive-security.service.js';
import { type OAuthConfig, type OAuthTransport } from '../src/services/google-drive-oauth.service.js';

const administratorId = '11111111-1111-4111-8111-111111111111';
const rootId = recordingDriveRootId();
const config: OAuthConfig = { clientId: 'mock', clientSecret: 'mock', callbackUrl: 'https://api.example.invalid/callback', administratorId };
const folderMimeType = 'application/vnd.google-apps.folder';

test('backend Drive client requests only root metadata and direct children', async () => {
  let saved: { googleAccountEmail: string; encryptedRefreshToken: string } | null = null;
  const repository: IntegrationCredentialRepository = { save: async value => { saved = value; }, load: async () => saved, remove: async () => { saved = null; } };
  const credentials = new IntegrationCredentialService(repository, administratorId, randomBytes(32));
  await credentials.replace(administratorId, 'owner@example.invalid', 'mock-refresh');
  const calls: Array<{ url: URL; method: string; body?: string }> = [];
  const transport: OAuthTransport = {
    exchangeCode: async () => { throw new Error('unused'); },
    refresh: async () => ({ access_token: 'mock-access' }),
    accountEmail: async () => 'owner@example.invalid',
    rootMetadata: async (_token, id) => ({ id, mimeType: folderMimeType, trashed: false, isAppAuthorized: true, capabilities: { canListChildren: true, canAddChildren: true } }),
  };
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'newBatchFolder123', name: 'SAP MM', mimeType: folderMimeType, parents: [rootId] }), { status: 200 });
    return new Response(JSON.stringify({ files: [{ id: 'existingFolder123', name: 'SAP FICO', mimeType: folderMimeType, parents: [rootId] }] }), { status: 200 });
  }) as typeof fetch;
  const client = new BackendRecordingDriveClient(config, transport, credentials, fetcher);
  assert.equal((await client.getFolder(rootId))?.id, rootId);
  assert.equal((await client.getFolder('existingFolder123'))?.id, 'existingFolder123');
  assert.equal(await client.getFolder('outsideFolder123'), null);
  await assert.rejects(client.listChildren('outsideFolder123'));
  await assert.rejects(client.createFolder('outsideFolder123', 'wrong'));
  const created = await client.createFolder(rootId, ' SAP MM ');
  assert.equal(created.id, 'newBatchFolder123');
  assert.ok(calls.every(call => call.url.pathname === '/drive/v3/files'));
  assert.ok(calls.filter(call => call.method === 'GET').every(call => call.url.searchParams.get('q')?.includes(`'${rootId}' in parents`)));
  assert.deepEqual(JSON.parse(calls.find(call => call.method === 'POST')!.body!), { name: 'SAP MM', mimeType: folderMimeType, parents: [rootId] });
});

test('backend Drive client refuses operations when root authorization is missing', async () => {
  let saved: { googleAccountEmail: string; encryptedRefreshToken: string } | null = null;
  const repository: IntegrationCredentialRepository = { save: async value => { saved = value; }, load: async () => saved, remove: async () => { saved = null; } };
  const credentials = new IntegrationCredentialService(repository, administratorId, randomBytes(32));
  await credentials.replace(administratorId, 'owner@example.invalid', 'mock-refresh');
  const transport: OAuthTransport = { exchangeCode: async () => ({}), refresh: async () => ({ access_token: 'mock-access' }), accountEmail: async () => '', rootMetadata: async () => ({ id: rootId, mimeType: folderMimeType, isAppAuthorized: false }) };
  const client = new BackendRecordingDriveClient(config, transport, credentials, async () => { throw new Error('Drive request must not occur'); });
  await assert.rejects(client.listChildren(rootId));
});
