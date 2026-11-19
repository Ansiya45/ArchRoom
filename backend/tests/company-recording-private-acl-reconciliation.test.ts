import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcilePrivateAclPermissions } from '../src/services/company-recording-private-acl-reconciliation.js';

const readers = [{ userId: 'u1', email: 'one@example.com', permissionId: 'p1' }, { userId: 'u2', email: 'two@example.com', permissionId: null }];
test('plans missing, obsolete, and duplicate direct reader changes', () => {
  const result = reconcilePrivateAclPermissions('company@example.com', readers, [
    { id: 'owner', type: 'user', email: 'company@example.com', role: 'owner' },
    { id: 'p1', type: 'user', email: 'one@example.com', role: 'reader' },
    { id: 'duplicate', type: 'user', email: 'one@example.com', role: 'reader' },
    { id: 'obsolete', type: 'user', email: 'old@example.com', role: 'reader' },
  ]);
  assert.equal(result.status, 'incomplete'); if (result.status === 'incomplete') {
    assert.deepEqual(result.missing.map(r => r.email), ['two@example.com']);
    assert.deepEqual(result.obsolete.map(r => r.email), ['old@example.com']);
    assert.deepEqual(result.duplicates.map(r => r.email), ['one@example.com']);
  }
});
test('blocks public, inherited, writer, and invalid ownership states', () => {
  for (const permission of [
    { id: 'public', type: 'anyone', role: 'reader' },
    { id: 'inherited', type: 'user', email: 'one@example.com', role: 'reader', inherited: true },
    { id: 'writer', type: 'user', email: 'one@example.com', role: 'writer' },
    { id: 'owner', type: 'user', email: 'company@example.com', role: 'writer' },
  ]) assert.equal(reconcilePrivateAclPermissions('company@example.com', readers, [permission]).status, 'blocked');
  assert.equal(reconcilePrivateAclPermissions('company@example.com', readers, []).status, 'blocked');
});
