import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { memoryCredentialRepository } from './drive-credential-memory.js';
import { IntegrationCredentialService } from '../src/services/drive-security.service.js';
import { BackendRecordingDriveClient } from '../src/services/backend-recording-drive-client.js';
import { GoogleDriveOAuthService, OAuthFlowStore, driveScope, type OAuthTransport } from '../src/services/google-drive-oauth.service.js';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';

const admin = '11111111-1111-4111-8111-111111111111';
const config = { clientId: 'mock', clientSecret: 'mock', callbackUrl: 'https://example.invalid/google-drive/oauth/callback', administratorId: admin };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function setup(overrides: Partial<OAuthTransport> = {}) {
  const memory = memoryCredentialRepository();
  const key = randomBytes(32);
  const first = new IntegrationCredentialService(memory.repository, admin, key);
  const second = new IntegrationCredentialService(memory.repository, admin, key);
  const root = recordingDriveRootId();
  const transport: OAuthTransport = {
    exchangeCode: async () => ({ access_token: 'access', refresh_token: 'refresh', scope: driveScope }),
    refresh: async () => ({ access_token: 'access', refresh_token: 'rotated' }),
    accountEmail: async () => 'owner@example.invalid',
    rootMetadata: async () => ({ id: root, mimeType: 'application/vnd.google-apps.folder', trashed: false, isAppAuthorized: true, capabilities: { canListChildren: true, canAddChildren: true } }),
    ...overrides,
  };
  const oauth = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, first, async () => true);
  const other = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, second, async () => true);
  return { first, second, oauth, other, transport, memory, root };
}
async function seed(credentials: IntegrationCredentialService) {
  await credentials.replace(admin, 'owner@example.invalid', 'initial', await credentials.generation());
}
function state(url: string) { return new URL(url).searchParams.get('state')!; }

for (const path of ['status', 'verify', 'picker', 'folder'] as const) {
  test(`disconnect prevents stale credential rotation in ${path}`, async () => {
    const entered = deferred<void>();
    const resume = deferred<void>();
    const ctx = setup({ refresh: async () => { entered.resolve(); await resume.promise; return { access_token: 'access', refresh_token: 'rotated' }; } });
    await seed(ctx.first);
    const client = new BackendRecordingDriveClient(config, ctx.transport, ctx.first, async () => { throw new Error('unexpected Drive request'); });
    const request = path === 'status' ? ctx.oauth.status(admin) : path === 'verify' ? ctx.oauth.verifySelectedRoot(admin, ctx.root) : path === 'picker' ? ctx.oauth.pickerAccess(admin) : client.listChildren(ctx.root);
    await entered.promise;
    await ctx.other.disconnect(admin);
    resume.resolve();
    if (path === 'status') assert.equal((await request as { connected: boolean }).connected, false);
    else await assert.rejects(request);
    assert.equal(await ctx.first.loadForBackend(), null);
  });
}

test('callback in flight cannot complete after disconnect; newly initiated authorization can reconnect', async () => {
  const entered = deferred<void>(); const resume = deferred<void>(); let blocked = true;
  const ctx = setup({ exchangeCode: async () => { if (blocked) { entered.resolve(); await resume.promise; } return { access_token: 'access', refresh_token: 'refresh', scope: driveScope }; } });
  const old = await ctx.oauth.start(admin, 'session');
  const callback = ctx.oauth.complete({ state: state(old.authorizationUrl), cookie: old.cookie, code: 'code' });
  await entered.promise; await ctx.other.disconnect(admin); resume.resolve();
  await assert.rejects(callback);
  assert.equal(await ctx.first.loadForBackend(), null);
  blocked = false;
  const next = await ctx.oauth.start(admin, 'session');
  await ctx.oauth.complete({ state: state(next.authorizationUrl), cookie: next.cookie, code: 'code' });
  await ctx.oauth.verifySelectedRoot(admin, ctx.root);
  assert.equal((await ctx.first.loadForBackend())?.refreshToken, 'rotated');
});

test('pending root verification cannot restore credentials after another instance disconnects', async () => {
  const entered = deferred<void>(); const resume = deferred<void>();
  const ctx = setup({ refresh: async () => { entered.resolve(); await resume.promise; return { access_token: 'access', refresh_token: 'rotated' }; } });
  const flow = await ctx.oauth.start(admin, 'session');
  await ctx.oauth.complete({ state: state(flow.authorizationUrl), cookie: flow.cookie, code: 'code' });
  const verification = ctx.oauth.verifySelectedRoot(admin, ctx.root);
  await entered.promise; await ctx.other.disconnect(admin); resume.resolve();
  await assert.rejects(verification);
  assert.equal(await ctx.first.loadForBackend(), null);
});

test('concurrent rotations use compare-and-set and cannot overwrite a newer token', async () => {
  const ctx = setup(); await seed(ctx.first);
  const a = (await ctx.first.loadForBackend())!; const b = (await ctx.second.loadForBackend())!;
  const results = await Promise.allSettled([
    ctx.first.replace(admin, a.googleAccountEmail, 'first', a.generation, a.ciphertext),
    ctx.second.replace(admin, b.googleAccountEmail, 'second', b.generation, b.ciphertext),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.ok(['first', 'second'].includes((await ctx.first.loadForBackend())!.refreshToken));
});

test('disconnect is administrator-only and repeated disconnect invalidates every generation', async () => {
  const ctx = setup(); await seed(ctx.first); const before = await ctx.first.generation();
  await assert.rejects(ctx.other.disconnect('other-user'));
  assert.equal(await ctx.first.generation(), before);
  await ctx.other.disconnect(admin); const after = await ctx.first.generation();
  await ctx.other.disconnect(admin); assert.notEqual(await ctx.first.generation(), after);
  assert.equal(await ctx.first.loadForBackend(), null);
});

test('a stale pending authorization on another instance cannot return a Picker token', async () => {
  const ctx = setup();
  const flow = await ctx.oauth.start(admin, 'session');
  await ctx.oauth.complete({ state: state(flow.authorizationUrl), cookie: flow.cookie, code: 'code' });
  await ctx.other.disconnect(admin);
  await assert.rejects(ctx.oauth.pickerAccess(admin));
  assert.equal((await ctx.oauth.status(admin)).connectionState, 'not_connected');
  assert.equal(await ctx.first.loadForBackend(), null);
});

test('disconnect during refresh without rotation does not return a usable Picker token', async () => {
  const entered = deferred<void>(); const resume = deferred<void>();
  const ctx = setup({ refresh: async () => { entered.resolve(); await resume.promise; return { access_token: 'access' }; } });
  await seed(ctx.first);
  const request = ctx.oauth.pickerAccess(admin);
  await entered.promise; await ctx.other.disconnect(admin); resume.resolve();
  await assert.rejects(request);
  assert.equal(await ctx.first.loadForBackend(), null);
});

test('simultaneous refreshes from two service instances cannot overwrite a newer rotation', async () => {
  const bothEntered = deferred<void>(); const resume = deferred<void>(); let count = 0;
  const ctx = setup({ refresh: async () => {
    const number = ++count;
    if (count === 2) bothEntered.resolve();
    await resume.promise;
    return { access_token: 'access', refresh_token: `rotation-${number}` };
  } });
  await seed(ctx.first);
  const requests = [ctx.oauth.pickerAccess(admin), ctx.other.pickerAccess(admin)];
  await bothEntered.promise; resume.resolve();
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.ok(['rotation-1', 'rotation-2'].includes((await ctx.first.loadForBackend())!.refreshToken));
});

test('a callback received after another instance disconnects never exchanges its code', async () => {
  let exchanges = 0;
  const ctx = setup({ exchangeCode: async () => { exchanges++; return { access_token: 'access', refresh_token: 'refresh', scope: driveScope }; } });
  const flow = await ctx.oauth.start(admin, 'session');
  await ctx.other.disconnect(admin);
  await assert.rejects(ctx.oauth.complete({ state: state(flow.authorizationUrl), cookie: flow.cookie, code: 'code' }));
  assert.equal(exchanges, 0);
  assert.equal(await ctx.first.loadForBackend(), null);
});
