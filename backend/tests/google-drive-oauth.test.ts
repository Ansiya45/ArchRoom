import { memoryCredentialRepository } from './drive-credential-memory.js';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { IntegrationCredentialService, type IntegrationCredentialRepository } from '../src/services/drive-security.service.js';
import { GoogleDriveOAuthService, GoogleOAuthHttpTransport, OAuthFlowStore, assertVerifiedRoot, driveScope, validateOAuthConfig, type OAuthConfig, type OAuthTransport, type RootMetadata } from '../src/services/google-drive-oauth.service.js';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';

const administratorId = '11111111-1111-4111-8111-111111111111';
const ordinaryId = '22222222-2222-4222-8222-222222222222';
const config: OAuthConfig = { clientId: 'mock-client', clientSecret: 'mock-secret', callbackUrl: 'https://api.example.invalid/google-drive/oauth/callback', administratorId };
const validRoot = (): RootMetadata => ({ id: recordingDriveRootId(), mimeType: 'application/vnd.google-apps.folder', trashed: false,
  isAppAuthorized: true, capabilities: { canListChildren: true, canAddChildren: true } });

function setup(overrides: Partial<OAuthTransport> = {}) {
  const memory = memoryCredentialRepository();
  const { repository } = memory;
  const credentials = new IntegrationCredentialService(repository, administratorId, randomBytes(32));
  const transport: OAuthTransport = {
    exchangeCode: async () => ({ access_token: 'access-secret', refresh_token: 'refresh-secret', scope: driveScope }),
    refresh: async () => ({ access_token: 'refreshed-secret', expires_in: 3600 }),
    accountEmail: async () => 'owner@example.invalid',
    rootMetadata: async () => validRoot(),
    ...overrides,
  };
  let active = true;
  const service = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, credentials,
    async (userId, sessionId) => active && userId === administratorId && sessionId === 'active-session');
  return { service, credentials, stored: memory.stored, writes: memory.writes, deactivate: () => { active = false; } };
}

function stateFrom(authorizationUrl: string) { return new URL(authorizationUrl).searchParams.get('state')!; }

test('only administrator starts OAuth; URL requests offline drive.file with S256 PKCE', async () => {
  const { service } = setup();
  await assert.rejects(service.start(ordinaryId, 'active-session'));
  await assert.rejects(service.start(administratorId, undefined));
  const result = await service.start(administratorId, 'active-session');
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), driveScope);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(stateFrom(result.authorizationUrl));
  assert.ok(!result.authorizationUrl.includes(config.clientSecret));
});

test('connection status stays disconnected until backend root verification and fails closed on lost capabilities', async () => {
  let root = validRoot();
  const { service } = setup({ rootMetadata: async () => root });
  assert.deepEqual(await service.status(administratorId), { connected: false, pending: false, connectionState: 'not_connected', accountEmail: null });
  await assert.rejects(service.status(ordinaryId));
  const flow = await service.start(administratorId, 'active-session');
  await service.complete({ state: stateFrom(flow.authorizationUrl), cookie: flow.cookie, code: 'mock-code' });
  assert.deepEqual(await service.status(administratorId), { connected: false, pending: true, connectionState: 'pending', accountEmail: 'owner@example.invalid' });
  await service.verifySelectedRoot(administratorId, recordingDriveRootId());
  assert.deepEqual(await service.status(administratorId), { connected: true, pending: false, connectionState: 'connected', accountEmail: 'owner@example.invalid' });
  root = { ...root, capabilities: { canListChildren: false, canAddChildren: true } };
  assert.deepEqual(await service.status(administratorId), { connected: false, pending: false, connectionState: 'root_unverified', accountEmail: 'owner@example.invalid' });
});

test('status separates unavailable authorization, unverified root, and storage errors without returning tokens', async () => {
  const expired = setup({ refresh: async () => { throw new Error('provider private detail'); } });
  await expired.credentials.replace(administratorId, 'owner@example.invalid', 'synthetic-refresh', await expired.credentials.generation());
  const authorization = await expired.service.status(administratorId);
  assert.deepEqual(authorization, { connected: false, pending: false, connectionState: 'authorization_unavailable', accountEmail: 'owner@example.invalid' });
  assert.ok(!JSON.stringify(authorization).includes('synthetic-refresh'));
  assert.ok(!JSON.stringify(authorization).includes('provider private detail'));
  const missingRoot = setup({ rootMetadata: async () => { throw new Error('provider private detail'); } });
  await missingRoot.credentials.replace(administratorId, 'owner@example.invalid', 'synthetic-refresh', await missingRoot.credentials.generation());
  assert.deepEqual(await missingRoot.service.status(administratorId), { connected: false, pending: false, connectionState: 'root_unverified', accountEmail: 'owner@example.invalid' });
  const brokenRepository: IntegrationCredentialRepository = { ...memoryCredentialRepository().repository, load: async () => { throw new Error('database private detail'); } };
  const credentials = new IntegrationCredentialService(brokenRepository, administratorId, randomBytes(32));
  const transport: OAuthTransport = { refresh: async () => ({}), exchangeCode: async () => ({}), accountEmail: async () => '', rootMetadata: async () => ({}) };
  const service = new GoogleDriveOAuthService(config, new OAuthFlowStore(), transport, credentials, async () => true);
  assert.deepEqual(await service.status(administratorId), { connected: false, pending: false, connectionState: 'status_unavailable', accountEmail: null });
  await assert.rejects(service.status(ordinaryId));
});

test('the callback exchanges the code with the verifier matching its S256 challenge', async () => {
  let exchangedVerifier = '';
  const { service } = setup({ exchangeCode: async (_config, _code, verifier) => {
    exchangedVerifier = verifier;
    return { access_token: 'access-secret', refresh_token: 'refresh-secret', scope: driveScope };
  } });
  const started = await service.start(administratorId, 'active-session');
  const url = new URL(started.authorizationUrl);
  await service.complete({ state: stateFrom(started.authorizationUrl), cookie: started.cookie, code: 'mock-code' });
  assert.equal(createHash('sha256').update(exchangedVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
});

test('missing OAuth setup fails closed and provider errors do not reveal secrets', async () => {
  assert.throws(() => validateOAuthConfig({ ...config, administratorId: undefined }));
  assert.throws(() => validateOAuthConfig({ ...config, callbackUrl: 'https://api.example.invalid/other' }));
  const transport = new GoogleOAuthHttpTransport(async () => new Response(JSON.stringify({ error: 'invalid_grant', secret: 'provider-secret' }), { status: 400 }));
  await assert.rejects(transport.exchangeCode(config, 'authorization-code', 'pkce-verifier'), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(config.clientSecret));
    assert.ok(!error.message.includes('provider-secret'));
    assert.ok(!error.message.includes('authorization-code'));
    return true;
  });
});

test('callback requires matching browser cookie and active administrator session; replay fails', async () => {
  const { service, writes } = setup();
  const first = await service.start(administratorId, 'active-session');
  await assert.rejects(service.complete({ state: stateFrom(first.authorizationUrl), cookie: 'wrong', code: 'mock-code' }));
  await assert.rejects(service.complete({ state: stateFrom(first.authorizationUrl), cookie: first.cookie, code: 'mock-code' }));
  const second = await service.start(administratorId, 'active-session');
  await service.complete({ state: stateFrom(second.authorizationUrl), cookie: second.cookie, code: 'mock-code' });
  await assert.rejects(service.complete({ state: stateFrom(second.authorizationUrl), cookie: second.cookie, code: 'mock-code' }));
  assert.equal(writes(), 0); // Consent is pending root verification.
  const expired = setup();
  const third = await expired.service.start(administratorId, 'active-session');
  expired.deactivate();
  await assert.rejects(expired.service.complete({ state: stateFrom(third.authorizationUrl), cookie: third.cookie, code: 'mock-code' }));
  assert.equal(expired.writes(), 0);
});

test('OAuth denial or missing offline refresh token does not persist a credential', async () => {
  const denied = setup();
  const first = await denied.service.start(administratorId, 'active-session');
  await assert.rejects(denied.service.complete({ state: stateFrom(first.authorizationUrl), cookie: first.cookie, error: 'access_denied' }));
  assert.equal(denied.writes(), 0);
  const missing = setup({ exchangeCode: async () => ({ access_token: 'access-secret', scope: driveScope }) });
  const second = await missing.service.start(administratorId, 'active-session');
  await assert.rejects(missing.service.complete({ state: stateFrom(second.authorizationUrl), cookie: second.cookie, code: 'mock-code' }));
  assert.equal(missing.writes(), 0);
});

test('root verification rejects wrong, trashed, unselected or insufficient-capability folders', async () => {
  const rootId = recordingDriveRootId();
  for (const root of [
    { ...validRoot(), id: 'differentFolder123' },
    { ...validRoot(), trashed: true },
    { ...validRoot(), trashed: undefined },
    { ...validRoot(), isAppAuthorized: false },
    { ...validRoot(), capabilities: { canListChildren: false, canAddChildren: true } },
    { ...validRoot(), capabilities: { canListChildren: true, canAddChildren: false } },
  ]) assert.throws(() => assertVerifiedRoot(root, rootId));
  const { service } = setup();
  await assert.rejects(service.verifySelectedRoot(ordinaryId, rootId));
  await assert.rejects(service.verifySelectedRoot(administratorId, 'differentFolder123'));
  await assert.rejects(service.verifySelectedRoot(administratorId, rootId)); // no credential yet
});

test('credential stays encrypted and refresh rotation is persisted after verified root selection', async () => {
  const result = setup({ refresh: async () => ({ access_token: 'new-access-secret', refresh_token: 'rotated-refresh-secret', expires_in: 3600 }) });
  const started = await result.service.start(administratorId, 'active-session');
  await result.service.complete({ state: stateFrom(started.authorizationUrl), cookie: started.cookie, code: 'mock-code' });
  assert.equal(result.stored(), null);
  assert.equal((await result.service.pickerAccess(administratorId)).accessToken, 'access-secret');
  await result.service.verifySelectedRoot(administratorId, recordingDriveRootId());
  assert.ok(!JSON.stringify(result.stored()).includes('refresh-secret'));
  assert.equal((await result.credentials.loadForBackend())?.refreshToken, 'rotated-refresh-secret');
  const picker = await result.service.pickerAccess(administratorId);
  assert.equal(picker.accessToken, 'new-access-secret');
  assert.equal(picker.expiresIn, 300);
  await assert.rejects(result.service.pickerAccess(ordinaryId));
  await assert.rejects(result.service.disconnect(ordinaryId));
  await result.service.disconnect(administratorId);
  assert.equal(result.stored(), null);
});

test('failed root verification never replaces an existing encrypted connection', async () => {
  const result = setup({ rootMetadata: async () => ({ ...validRoot(), isAppAuthorized: false }) });
  await result.credentials.replace(administratorId, 'previous@example.invalid', 'previous-refresh', await result.credentials.generation());
  const started = await result.service.start(administratorId, 'active-session');
  await result.service.complete({ state: stateFrom(started.authorizationUrl), cookie: started.cookie, code: 'mock-code' });
  await assert.rejects(result.service.verifySelectedRoot(administratorId, recordingDriveRootId()));
  const prior = await result.credentials.loadForBackend();
  assert.equal(prior?.googleAccountEmail, 'previous@example.invalid');
  assert.equal(prior?.refreshToken, 'previous-refresh');
});
