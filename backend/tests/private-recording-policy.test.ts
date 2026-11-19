import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePrivateRecordingReaders, type PrivatePolicyInput } from '../src/services/private-recording-policy.js';
const identity = (userId: string) => ({ userId, subject: `google-${userId}`, email: `${userId}@example.com`, verified: true });
const base: PrivatePolicyInput = { mode: 'private', companySubject: 'company', companyEmail: 'company@example.com',
  creatorId: 'creator', recordingHostId: 'creator', durableHostIds: [], managerIds: ['manager'],
  identities: [identity('creator'), identity('manager'), identity('student')] };
test('compiles only creator, durable host and explicitly supplied authorized managers as intended readers', () => {
  assert.deepEqual(compilePrivateRecordingReaders(base), { status: 'READY_FOR_ACL',
    readers: [identity('creator'), identity('manager')].map(({ subject, email }) => ({ subject, email })) });
  const host = identity('host');
  assert.equal(compilePrivateRecordingReaders({ ...base, recordingHostId: 'host', durableHostIds: ['host'],
    identities: [...base.identities, host] }).status, 'READY_FOR_ACL');
});
test('never treats restricted or link sharing as private policy completion', () => {
  for (const mode of ['restricted', 'anyone_with_link', 'anyone', '', 'Private'])
    assert.deepEqual(compilePrivateRecordingReaders({ ...base, mode }), { status: 'BLOCKED', reason: 'UNSUPPORTED_MODE' });
});
test('temporary promoted hosts cannot gain reader access', () => {
  assert.deepEqual(compilePrivateRecordingReaders({ ...base, recordingHostId: 'student' }),
    { status: 'BLOCKED', reason: 'DURABLE_HOST_REQUIRED' });
});
test('missing or unverified Google identities block instead of inferring from email', () => {
  for (const identities of [[], [identity('creator')], [identity('creator'), { ...identity('manager'), verified: false }]])
    assert.deepEqual(compilePrivateRecordingReaders({ ...base, identities }), { status: 'BLOCKED', reason: 'IDENTITY_REQUIRED' });
});
test('ambiguous account mapping and subject/email collisions fail closed', () => {
  for (const identities of [[...base.identities, identity('creator')],
    [identity('creator'), { ...identity('manager'), subject: 'google-creator' }],
    [identity('creator'), { ...identity('manager'), email: 'creator@example.com' }]])
    assert.deepEqual(compilePrivateRecordingReaders({ ...base, identities }), { status: 'BLOCKED', reason: 'AMBIGUOUS_IDENTITY' });
});
test('company owner is not granted a reader downgrade', () => {
  assert.deepEqual(compilePrivateRecordingReaders({ ...base, companySubject: 'google-creator', companyEmail: 'creator@example.com' }),
    { status: 'READY_FOR_ACL', readers: [{ subject: 'google-manager', email: 'manager@example.com' }] });
});
