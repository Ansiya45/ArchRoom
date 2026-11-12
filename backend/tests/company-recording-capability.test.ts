import assert from 'node:assert/strict';
import { test } from 'node:test';
import { companyRecordingCapability } from '../src/services/company-recording-capability.service.js';
import { encryptRefreshToken } from '../src/services/drive-security.service.js';
import { recordingsRouter } from '../src/routers/recordings.js';

const key = Buffer.alloc(32, 9);
const config = { nodeEnv: 'test', jobsEnabled: true, localEnabled: true,
  databaseUrl: 'postgres://test@127.0.0.1:55451/ylaam_staging_disposable_0021',
  clientId: 'mock-client', clientSecret: 'mock-secret', callbackUrl: 'http://localhost/google-drive/oauth/callback',
  administratorId: '00000000-0000-4000-8000-000000000001', tokenKey: key.toString('base64') };
const stored = { ciphertext: encryptRefreshToken('mock-refresh-token', key) };

test('company upload capability requires all local processing prerequisites', async () => {
  let inspected = false;
  assert.deepEqual(await companyRecordingCapability(config, async () => { inspected = true; return stored; }), { available: true });
  assert.equal(inspected, true);
  for (const change of [{ jobsEnabled: false }, { localEnabled: false }, { nodeEnv: 'production' },
    { databaseUrl: 'postgres://test@remote.example/ylaam_staging_disposable_0021' },
    { databaseUrl: 'postgres://test@127.0.0.1/development' }, { tokenKey: undefined }, { clientSecret: undefined }]) {
    let called = false;
    assert.deepEqual(await companyRecordingCapability({ ...config, ...change }, async () => { called = true; return stored; }), { available: false });
    assert.equal(called, false);
  }
  assert.deepEqual(await companyRecordingCapability(config, async () => null), { available: false });
  assert.deepEqual(await companyRecordingCapability(config, async () => { throw new Error('database unavailable'); }), { available: false });
  assert.deepEqual(await companyRecordingCapability({ ...config, tokenKey: Buffer.alloc(32, 8).toString('base64') }, async () => stored), { available: false });
});

test('company upload capability is authenticated and disabled by default', async () => {
  const unauthenticated = recordingsRouter.createCaller({ isAuthenticated: false, user: null } as never);
  await assert.rejects(unauthenticated.companyUploadCapability(), /Authentication required/);
  const authenticated = recordingsRouter.createCaller({ isAuthenticated: true, user: { id: config.administratorId, email: 'test@example.invalid' } } as never);
  assert.deepEqual(await authenticated.companyUploadCapability(), { available: false });
});
