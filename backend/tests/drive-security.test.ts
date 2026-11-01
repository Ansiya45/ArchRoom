import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { TRPCError } from '@trpc/server';
import { canAccessRecordingFolder, decryptRefreshToken, encryptRefreshToken, IntegrationCredentialService, parseTokenKey, type IntegrationCredentialRepository } from '../src/services/drive-security.service.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const ordinaryId = '22222222-2222-4222-8222-222222222222';

test('integration credential replacement is limited to the configured administrator', async () => {
  let saved: Awaited<ReturnType<IntegrationCredentialRepository['load']>> = null;
  let writes = 0;
  const repository: IntegrationCredentialRepository = {
    save: async value => { writes++; saved = value; },
    load: async () => saved,
    remove: async () => { saved = null; },
  };
  const key = randomBytes(32);
  const service = new IntegrationCredentialService(repository, adminId, key);
  for (const userId of [undefined, ordinaryId]) {
    await assert.rejects(service.replace(userId, 'integration@example.invalid', 'sensitive-refresh-token'), (error: unknown) => error instanceof TRPCError && error.code === 'FORBIDDEN');
  }
  const unconfigured = new IntegrationCredentialService(repository, undefined, key);
  await assert.rejects(unconfigured.replace(adminId, 'integration@example.invalid', 'sensitive-refresh-token'));
  assert.equal(writes, 0);
  await service.replace(adminId, 'integration@example.invalid', 'sensitive-refresh-token');
  assert.equal(writes, 1);
  assert.ok(saved);
  assert.equal(saved!.googleAccountEmail, 'integration@example.invalid');
  assert.ok(!JSON.stringify(saved).includes('sensitive-refresh-token'));
  assert.deepEqual(await service.loadForBackend(), { googleAccountEmail: 'integration@example.invalid', refreshToken: 'sensitive-refresh-token' });
});

test('refresh tokens are encrypted with an authenticated random nonce and tampering is rejected', () => {
  const key = randomBytes(32);
  const token = 'test-only-refresh-token';
  const first = encryptRefreshToken(token, key);
  const second = encryptRefreshToken(token, key);
  assert.notEqual(first, second);
  assert.ok(!first.includes(token));
  assert.equal(decryptRefreshToken(first, key), token);
  assert.throws(() => decryptRefreshToken(first, randomBytes(32)), /cannot be decrypted/);
  const parts = first.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.throws(() => decryptRefreshToken(parts.join('.'), key), /cannot be decrypted/);
  assert.equal(parseTokenKey(key.toString('base64')).toString('hex'), key.toString('hex'));
  assert.throws(() => parseTokenKey(undefined));
  assert.throws(() => parseTokenKey('too-short'));
});

test('root use and protected batch roles are enforced separately', () => {
  assert.equal(canAccessRecordingFolder(null, 'upload', undefined), true);
  assert.equal(canAccessRecordingFolder(null, 'manage', undefined), false);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'upload', undefined), false);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'upload', 'viewer'), false);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'view', 'viewer'), true);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'upload', 'trainer'), true);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'manage', 'trainer'), false);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'manage', 'manager'), true);
  assert.equal(canAccessRecordingFolder('batchFolder123', 'manage', undefined, true), true);
});
