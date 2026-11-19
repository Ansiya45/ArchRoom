import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingPrivateAclWorker } from '../src/services/company-recording-private-acl-worker.js';
import type { PrivateAclDriveClient } from '../src/services/company-recording-private-acl.service.js';
import type { PrivateAclInspection } from '../src/services/company-recording-private-acl-worker.js';

const file = { status:'SAFE' as const, fileId:'drive_file_12345', destinationId:'folder_12345', size:4, mimeType:'video/webm', sha256:'a'.repeat(64), checkedAt:new Date().toISOString() };
const readers = [{ userId:'u1', email:'one@example.com', permissionId:'p1' }];
const owner = { id:'owner', type:'user', email:'company@example.com', role:'owner' };
const reader = { id:'p1', type:'user', email:'one@example.com', role:'reader' };
const drive: PrivateAclDriveClient = { grantReader: async () => ({ permissionId:'p1', created:false }), revokeDirectReader: async () => ({ revoked:true }) };
test('worker grants missing reader, reinspects, and marks policy verified', async () => {
  let reads=0, granted=0, verified=0; const phases: Array<boolean | undefined> = [];
  const acl = { grantReader: async () => { granted++; return { state:'applied' as const, permissionId:'p1', created:true }; }, revokeReader: async () => ({ state:'revoked' as const, permissionId:'old' }), markVerified: async () => { verified++; return { verified:true as const }; } };
  const inspect = async (allowMissing?: boolean): Promise<PrivateAclInspection> => { phases.push(allowMissing); return { file, permissions: reads++ ? [owner,reader] : [owner] }; };
  const result=await new CompanyRecordingPrivateAclWorker(acl).reconcile({ policyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',policyVersion:1,companyEmail:'company@example.com',readers,operations:[{operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',userId:'u1'}],inspect,drive });
  assert.equal(result.state,'verified'); assert.equal(granted,1); assert.equal(verified,1); assert.equal(reads,2);
  assert.deepEqual(phases, [true, undefined]);
});
test('worker blocks unsafe inspection and does not mutate', async () => {
  let grants=0;
  const acl={ grantReader: async () => { grants++; return { state:'applied' as const,permissionId:'p1',created:true }; }, revokeReader: async () => ({state:'revoked' as const,permissionId:'old'}), markVerified: async () => ({verified:true as const}) };
  const result=await new CompanyRecordingPrivateAclWorker(acl).reconcile({policyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',policyVersion:1,companyEmail:'company@example.com',readers,operations:[],inspect:async()=>({file:{status:'UNVERIFIABLE',reason:'unknown'},permissions:[]}),drive});
  assert.equal(result.state,'reconciliation_required'); assert.equal(grants,0);
});
test('worker revokes obsolete direct reader and refuses partial post-check', async () => {
  let revoked=0, reads=0;
  const acl={ grantReader: async () => ({state:'applied' as const,permissionId:'p1',created:true}), revokeReader: async () => { revoked++; return {state:'revoked' as const,permissionId:'old'}; }, markVerified: async () => ({verified:true as const}) };
  const inspect=async():Promise<PrivateAclInspection>=>({file,permissions:reads++ ? [owner,reader] : [owner,reader,{id:'old',type:'user',email:'old@example.com',role:'reader'}]});
  const result=await new CompanyRecordingPrivateAclWorker(acl).reconcile({policyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',policyVersion:1,companyEmail:'company@example.com',readers,operations:[{operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',userId:'old',obsolete:true}],inspect,drive});
  assert.equal(result.state,'verified'); assert.equal(revoked,1);
});
test('worker preserves busy and ambiguous outcomes', async () => {
  const acl={ grantReader: async () => ({state:'busy' as const}), revokeReader: async () => ({state:'reconciliation_required' as const}), markVerified: async () => ({verified:true as const}) };
  const result=await new CompanyRecordingPrivateAclWorker(acl).reconcile({policyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',policyVersion:1,companyEmail:'company@example.com',readers,operations:[{operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',userId:'u1'}],inspect:async()=>({file,permissions:[owner]}),drive});
  assert.equal(result.state,'busy');
});
