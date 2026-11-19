import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRestrictedRecipients, validateAnyoneWithLink, resolveRestrictedRecipients, validateSharingTransition } from '../src/services/recording-sharing-policy.js';

test('restricted requires approved roster identities', () => {
  const result = validateRestrictedRecipients({ batchFolderId: 'batch', recipients: [{ userId: 's', googleSubject: 'sub', googleEmail: 's@example.com', approved: true, authorized: true }] });
  assert.equal(result.length, 1);
  assert.throws(() => validateRestrictedRecipients({ batchFolderId: null, recipients: [] }));
  assert.throws(() => validateRestrictedRecipients({ batchFolderId: 'batch', recipients: [{ userId: 's', approved: false, authorized: true }] }));
});

test('restricted combines approved students and authorized staff', () => {
  const result = resolveRestrictedRecipients({ batchFolderId: 'batch', students: [{ userId: 's', googleSubject: 'ss', googleEmail: 's@example.com', approved: true, authorized: true }], staff: [{ userId: 'm', googleSubject: 'mm', googleEmail: 'm@example.com', approved: true, authorized: true }] });
  assert.equal(result.length, 2);
});

test('public access must be revoked before switching away', () => {
  assert.throws(() => validateSharingTransition({ from: 'anyone_with_link', to: 'private', publicPermissionRevoked: false }));
  assert.equal(validateSharingTransition({ from: 'anyone_with_link', to: 'private', publicPermissionRevoked: true }), true);
});

test('anyone-with-link requires explicit host authorization', () => {
  assert.deepEqual(validateAnyoneWithLink({ mode: 'anyone_with_link', hostConfirmed: true, explicitHostAuthorization: true }), { type: 'anyone', role: 'reader' });
  assert.throws(() => validateAnyoneWithLink({ mode: 'anyone_with_link', hostConfirmed: false, explicitHostAuthorization: true }));
});
