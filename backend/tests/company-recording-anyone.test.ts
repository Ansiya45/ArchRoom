import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sql } from 'postgres';
import { CompanyRecordingAnyoneConfirmationService } from '../src/services/company-recording-anyone-confirmation.service.js';
import { CompanyRecordingPrivateAclWorker } from '../src/services/company-recording-private-acl-worker.js';
import type { FileInspection } from '../src/services/company-recording-drive-file-inspector.js';

test('confirmation requires the durable host, exact initial version, and unused confirmation', async () => {
  let consumed = false;
  const query = async (parts: TemplateStringsArray) => {
    const text = parts.join('?');
    if (text.includes('from company_recording_upload_jobs')) return [{ recording_id:'recording', host_user_id:'host', owner_user_id:'host', access_policy:'anyone_with_link' }];
    if (text.includes('from company_recording_private_policies')) return [];
    if (text.includes('insert into company_recording_anyone_confirmations')) return consumed ? [] : [{ id:'confirmation', confirmed_at:new Date() }];
    throw new Error('Unexpected query');
  };
  const sql = Object.assign(query, { begin: async (fn:(tx:unknown)=>unknown) => fn(query) }) as unknown as Sql;
  const service = new CompanyRecordingAnyoneConfirmationService(sql);
  assert.equal((await service.confirm('job','host',1)).confirmationId,'confirmation');
  await assert.rejects(service.confirm('job','other',1), /not authorized/);
  await assert.rejects(service.confirm('job','host',2), /stale/);
  consumed = true;
  await assert.rejects(service.confirm('job','host',1), /already used/);
});

test('replacement confirmation requires the next verified policy version and authorized host', async () => {
  let current = { id:'policy', policy_version:3, policy_mode:'private', status:'verified', reconciliation_status:'resolved' };
  const query = async (parts: TemplateStringsArray) => {
    const text = parts.join('?');
    if (text.includes('from company_recording_upload_jobs')) return [{ recording_id:'recording', host_user_id:'host', owner_user_id:'host', access_policy:'private' }];
    if (text.includes('from company_recording_private_policies')) return [current];
    if (text.includes('insert into company_recording_anyone_confirmations')) return [{ id:'confirmation', confirmed_at:new Date() }];
    throw new Error('Unexpected query');
  };
  const sql = Object.assign(query, { begin: async (fn:(tx:unknown)=>unknown) => fn(query) }) as unknown as Sql;
  const service = new CompanyRecordingAnyoneConfirmationService(sql);
  assert.equal((await service.confirm('job','host',4)).confirmationId,'confirmation');
  await assert.rejects(service.confirm('job','other',4), /not authorized/);
  await assert.rejects(service.confirm('job','host',3), /stale/);
  await assert.rejects(service.confirm('job','host',5), /stale/);
  current = { ...current, status:'reconciliation_required' };
  await assert.rejects(service.confirm('job','host',4), /reconciliation/);
  current = { ...current, status:'verified', policy_mode:'anyone_with_link' };
  await assert.rejects(service.confirm('job','host',4), /stale/);
});

const safe: FileInspection = { status:'SAFE', fileId:'file_123456', destinationId:'folder_123456', size:4, mimeType:'video/webm', sha256:'a'.repeat(64), checkedAt:'now' };
const blocked: FileInspection = { status:'BLOCKED', reason:'not yet public' };
const drive = { grantReader:async()=>({permissionId:'reader',created:true}), revokeDirectReader:async()=>({revoked:true}) };

test('public grant is independently inspected before verification', async () => {
  let publicPresent = false, verified = 0;
  const acl = { grantReader:async()=>({state:'busy' as const}), revokeReader:async()=>({state:'reconciliation_required' as const}),
    grantAnyone:async()=>{ publicPresent=true; return {state:'applied' as const}; }, markVerified:async()=>{ verified++; return {verified:true as const}; } };
  const worker = new CompanyRecordingPrivateAclWorker(acl);
  const result = await worker.reconcileAnyone({ policyId:'p',policyVersion:1,operationId:'o',drive,companyAccountEmail:'company@example.test',credentialGeneration:'generation',
    inspectOwnerOnly:async()=>safe, inspectPublic:async()=>publicPresent ? safe : blocked });
  assert.equal(result.state,'verified'); assert.equal(verified,1);
});

test('failed grant and unsafe final inspection prevent verification', async () => {
  for (const failure of ['grant','inspection']) {
    let reads=0, verified=0;
    const acl = { grantReader:async()=>({state:'busy' as const}), revokeReader:async()=>({state:'reconciliation_required' as const}),
      grantAnyone:async()=>({state: failure === 'grant' ? 'reconciliation_required' as const : 'applied' as const}), markVerified:async()=>{verified++;return {verified:true as const};} };
    const result = await new CompanyRecordingPrivateAclWorker(acl).reconcileAnyone({ policyId:'p',policyVersion:1,operationId:'o',drive,companyAccountEmail:'company@example.test',credentialGeneration:'generation',
      inspectOwnerOnly:async()=>safe, inspectPublic:async()=>{ reads++; return blocked; } });
    assert.equal(result.state,'reconciliation_required'); assert.equal(verified,0); assert.equal(reads, failure === 'grant' ? 1 : 2);
  }
});
