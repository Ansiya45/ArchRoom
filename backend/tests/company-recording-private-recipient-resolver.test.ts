import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrivateRecordingRecipientSnapshot } from '../src/services/company-recording-private-recipient-resolver.js';

const base = {
  jobId: 'job', ownerUserId: 'owner', hostUserId: 'owner', accessPolicy: 'private', destinationFolderId: 'folder',
  creatorIdentity: { googleSubject: 'sub-owner', googleEmail: 'owner@example.com' },
  managers: [{ userId: 'manager', googleSubject: 'sub-manager', googleEmail: 'manager@example.com' }],
};

test('resolves creator and authorized manager without enrollment', () => {
  const result = validatePrivateRecordingRecipientSnapshot(base);
  assert.deepEqual(result.map(r => r.userId), ['owner', 'manager']);
});

test('fails closed when policy or durable host is invalid', () => {
  assert.throws(() => validatePrivateRecordingRecipientSnapshot({ ...base, accessPolicy: 'restricted' }));
  assert.throws(() => validatePrivateRecordingRecipientSnapshot({ ...base, hostUserId: 'temporary-host' }));
});

test('fails closed when a required identity is missing', () => {
  assert.throws(() => validatePrivateRecordingRecipientSnapshot({ ...base, creatorIdentity: null }));
  assert.throws(() => validatePrivateRecordingRecipientSnapshot({ ...base, managers: [{ userId: 'manager' }] }));
});

test('deduplicates a manager matching the creator identity', () => {
  const result = validatePrivateRecordingRecipientSnapshot({ ...base,
    managers: [{ userId: 'manager', googleSubject: 'sub-owner', googleEmail: 'owner@example.com' }] });
  assert.equal(result.length, 1);
});
