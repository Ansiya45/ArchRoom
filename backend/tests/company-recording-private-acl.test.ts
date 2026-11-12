import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePrivateAclIntent, type PrivateAclIntentInput } from '../src/services/company-recording-private-acl.service.js';

const ids = { jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recordingId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', credentialGeneration:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', creatorId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd', hostId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd', managerId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
const base: PrivateAclIntentInput = { ...ids, driveFileId:'drive_file_12345', destinationFolderId:'folder_12345', companyAccountEmail:'company@example.com', policyMode:'private', policyVersion:1, durableHostIds:[], recipients:[
  { userId:ids.creatorId, kind:'creator', authorized:true, googleSubject:'creator-sub', googleEmail:'creator@example.com' },
  { userId:ids.managerId, kind:'manager', authorized:true, googleSubject:'manager-sub', googleEmail:'manager@example.com' },
] };
test('accepts verified creator and authorized manager readers without enrollment requirement', () => {
  assert.equal(validatePrivateAclIntent(base).length, 2);
});
test('rejects unsupported modes, missing identities, unauthorized and ambiguous recipients', () => {
  for (const change of [
    { policyMode:'unsupported' }, { policyMode:'anyone_with_link' },
    { recipients:base.recipients.slice(1) },
    { recipients:base.recipients.map((r, i) => i ? { ...r, authorized:false } : r) },
    { recipients:[...base.recipients, { userId:ids.creatorId, kind:'creator' as const, authorized:true, googleSubject:'other-sub', googleEmail:'other@example.com' }] },
  ]) assert.throws(() => validatePrivateAclIntent({ ...base, ...change } as PrivateAclIntentInput), /Private recording|supported|verified|authorized|ambiguous|confirmation/i);
});
test('requires durable authorization for a promoted host', () => {
  assert.throws(() => validatePrivateAclIntent({ ...base, hostId:ids.managerId, recipients:base.recipients.map(r => r.userId === ids.managerId ? { ...r, kind:'host' as const } : r) }), /durable/i);
  assert.equal(validatePrivateAclIntent({ ...base, hostId:ids.managerId, durableHostIds:[ids.managerId], recipients:base.recipients.map(r => r.userId === ids.managerId ? { ...r, kind:'host' as const } : r) }).length, 2);
});
test('rejects invalid destination, credential generation and policy version', () => {
  for (const change of [{ driveFileId:'bad' }, { destinationFolderId:'bad' }, { credentialGeneration:'bad' }, { policyVersion:0 }])
    assert.throws(() => validatePrivateAclIntent({ ...base, ...change } as PrivateAclIntentInput), /invalid/i);
});
