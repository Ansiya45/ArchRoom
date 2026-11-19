import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompanyRecordingSharingRuntimeService } from '../src/services/company-recording-sharing-runtime.service.js';
import { CompanyRecordingPrivateAclWorker } from '../src/services/company-recording-private-acl-worker.js';
import { CompanyRecordingPrivateAclService } from '../src/services/company-recording-private-acl.service.js';
import type { Sql } from 'postgres';

const drive = { grantReader:async()=>({permissionId:'reader',created:true}), revokeDirectReader:async()=>({revoked:true}) };
const input = { jobId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recordingId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', driveFileId:'drive_file_12345', destinationFolderId:'folder_12345', companyAccountEmail:'company@example.test', credentialGeneration:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', policyMode:'private', policyVersion:2, creatorId:'owner', hostId:'owner', durableHostIds:[], recipients:[{userId:'owner',kind:'creator' as const,authorized:true,googleSubject:'host-sub',googleEmail:'host@example.test'}] };

for (const [from, to] of [['private','restricted'], ['restricted','anyone_with_link'], ['anyone_with_link','private']] as const) {
  test(`${from} to ${to} waits for revocation before replacement inspection`, async () => {
    const calls:string[] = [];
    const acl = { replaceIntent:async()=>{calls.push('replace'); return {policyId:'new',idempotent:false,obsoleteOperations:[{policyId:'old',operationId:'op',permissionId:'permission',operationKind:from === 'anyone_with_link' ? 'anyone_reader' : 'direct_reader'}]};} };
    const worker = { revokeSuperseded:async()=>{calls.push('revoke'); return {state:'revoked'};} };
    const pipeline = { reconcileForJob:async()=>{calls.push('inspect'); return {state:'verified'};} };
    const result = await new CompanyRecordingSharingRuntimeService(acl as any, worker as any, pipeline).replace({...input,policyMode:to},drive);
    assert.equal(result.state,'verified'); assert.deepEqual(calls,['replace','revoke','inspect']);
  });
}

test('failed revocation never invokes replacement verification', async () => {
  let inspections = 0;
  const acl = { replaceIntent:async()=>({policyId:'new',idempotent:false,obsoleteOperations:[]}) };
  const worker = { revokeSuperseded:async()=>({state:'reconciliation_required'}) };
  const result = await new CompanyRecordingSharingRuntimeService(acl as any, worker as any, {reconcileForJob:async()=>{inspections++;return {state:'verified'};}}).replace(input,drive);
  assert.equal(result.state,'reconciliation_required'); assert.equal(inspections,0);
});

test('missing public revocation capability fails closed', async () => {
  let directCalls=0;
  const acl = { grantReader:async()=>({state:'busy' as const}), revokeReader:async()=>{directCalls++;return {state:'revoked' as const, permissionId:'p'};}, markVerified:async()=>({verified:true as const}) };
  const result = await new CompanyRecordingPrivateAclWorker(acl).revokeSuperseded({operations:[{policyId:'old',operationId:'op',operationKind:'anyone_reader'}],drive});
  assert.equal(result.state,'reconciliation_required'); assert.equal(directCalls,0);
});

test('replacement rejects an unauthorized host before changing the policy', async () => {
  let policyReads = 0;
  const tx = async (parts:TemplateStringsArray) => {
    const query = parts.join('?');
    if (query.includes('from company_recording_upload_jobs')) return [{ recording_id:input.recordingId, owner_user_id:'owner', host_user_id:'different-host' }];
    policyReads++; return [];
  };
  const sql = { begin: async (fn:(transaction:unknown)=>unknown) => fn(tx) } as unknown as Sql;
  await assert.rejects(new CompanyRecordingPrivateAclService(sql).replaceIntent(input), /not authorized/);
  assert.equal(policyReads,0);
});

test('replacement rejects missing, stale, and skipped policy versions', async () => {
  for (const active of [[], [{ id:'policy', policy_version:2 }], [{ id:'policy', policy_version:0 }]]) {
    const tx = async (parts:TemplateStringsArray) => {
      const query = parts.join('?');
      if (query.includes('from company_recording_upload_jobs')) return [{ recording_id:input.recordingId, owner_user_id:'owner', host_user_id:'owner' }];
      if (query.includes('from company_recording_private_policies')) return active;
      throw new Error('Unexpected mutation');
    };
    const sql = { begin: async (fn:(transaction:unknown)=>unknown) => fn(tx) } as unknown as Sql;
    await assert.rejects(new CompanyRecordingPrivateAclService(sql).replaceIntent(input), /stale/);
  }
});

function requestFixture(options: { host?:string; activeVersion?:number; activeMode?:string; priorVersion?:number; revoke?:string } = {}) {
  let writes=0, resolutions=0;
  const sql = (async () => [{ id:input.jobId,recording_id:input.recordingId,owner_user_id:'owner',host_user_id:options.host ?? 'owner',drive_file_id:input.driveFileId,destination_folder_id:input.destinationFolderId,policy_id:'policy',policy_status:options.priorVersion ? 'pending' : 'verified',reconciliation_status:options.priorVersion ? 'not_required' : 'resolved',policy_version:options.activeVersion ?? 1,policy_mode:options.activeMode ?? 'private',prior_version:options.priorVersion,company_account_email:input.companyAccountEmail,credential_generation:input.credentialGeneration }]) as unknown as Sql;
  const acl = { replaceIntent:async (intent:any, resolve:any) => { writes++; await resolve({},intent.policyMode); return {policyId:'policy',idempotent:false,obsoleteOperations:[]}; } };
  const worker = { revokeSuperseded:async()=>({state:options.revoke ?? 'revoked'}) };
  const runtime = new CompanyRecordingSharingRuntimeService(acl as any,worker as any,{reconcileForJob:async()=>({state:'verified'})},{
    sql,assertReady:()=>{},validateDestination:async()=>({status:'SAFE',destinationId:input.destinationFolderId}),
    access:async()=>({accountEmail:input.companyAccountEmail,credentialGeneration:input.credentialGeneration}),
    resolveRecipients:async()=>{resolutions++;return input.recipients;},drive,
  });
  return {runtime, counts:()=>({writes,resolutions})};
}

test('host requests only the next durable mode transition', async () => {
  const f=requestFixture(); const result=await f.runtime.requestChange(input.jobId,'owner','restricted',1);
  assert.equal(result.state,'verified'); assert.deepEqual(f.counts(),{writes:1,resolutions:1});
});
test('host request rejects unauthorized and stale versions before ACL mutation', async () => {
  const unauthorized=requestFixture({host:'other'}); await assert.rejects(unauthorized.runtime.requestChange(input.jobId,'owner','restricted',1),/not authorized/); assert.equal(unauthorized.counts().writes,0);
  const stale=requestFixture({activeVersion:3}); await assert.rejects(stale.runtime.requestChange(input.jobId,'owner','restricted',1),/stale/); assert.equal(stale.counts().writes,0);
});
test('identical retry is accepted for the linked previous version', async () => {
  const f=requestFixture({activeVersion:2,activeMode:'restricted',priorVersion:1});
  assert.equal((await f.runtime.requestChange(input.jobId,'owner','restricted',1)).state,'verified');
  const conflict=requestFixture({activeVersion:2,activeMode:'restricted',priorVersion:1});
  await assert.rejects(conflict.runtime.requestChange(input.jobId,'owner','private',1),/stale/);
});
