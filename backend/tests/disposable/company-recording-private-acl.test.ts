import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';

const url = process.env.DISPOSABLE_DATABASE_URL ?? '';
const parsed = (() => { try { return new URL(url); } catch { return null; } })();
test('Private ACL coordination on an isolated disposable PostgreSQL database', { timeout: 120000 }, async t => {
  if (!parsed || parsed.protocol !== 'postgres:' || !['127.0.0.1','localhost'].includes(parsed.hostname) || process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused' || !/^ylaam_phase6c_test_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw new Error('Unsafe disposable target');
  console.log(`Disposable PostgreSQL target: host=${parsed.hostname} port=${parsed.port || '5432'} database=${parsed.pathname.slice(1)}`);
  const sql = postgres(url, { max: 4 });
  try {
    const [target] = await sql`select current_database() name,inet_server_addr()::text host,inet_server_port() port`;
    assert.match(target.name,/^ylaam_phase6c_test_[a-z0-9_]+$/); assert.equal(target.host,'127.0.0.1/32'); assert.equal(Number(target.port),5432);
    const { CompanyRecordingPrivateAclService } = await import('../../src/services/company-recording-private-acl.service.js');
    const creator=randomUUID(), manager=randomUUID(), meeting=randomUUID(), job=randomUUID(), recording=randomUUID(), generation=randomUUID();
    await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values (${creator},'creator@example.invalid','x','Creator',now()),(${manager},'manager@example.invalid','x','Manager',now())`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id,recording_access_policy,status) values (${meeting},'YLM-ACL123','ACL test',${creator},'private','scheduled')`;
    await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id) values (${job},${recording},${creator},${meeting},'folder_12345','private','video/webm',4,${'a'.repeat(64)},'drive_file_12345')`;
    const service=new CompanyRecordingPrivateAclService(sql);
    const input={jobId:job,recordingId:recording,driveFileId:'drive_file_12345',destinationFolderId:'folder_12345',companyAccountEmail:'company@example.invalid',credentialGeneration:generation,policyMode:'private',policyVersion:1,creatorId:creator,hostId:creator,durableHostIds:[] as string[],recipients:[{userId:creator,kind:'creator' as const,authorized:true,googleSubject:'creator-sub',googleEmail:'creator@example.invalid'},{userId:manager,kind:'manager' as const,authorized:true,googleSubject:'manager-sub',googleEmail:'manager@example.invalid'}]};
    const first=await service.createIntent(input); const second=await service.createIntent(input); assert.equal(second.policyId,first.policyId); assert.equal(second.idempotent,true);
    await assert.rejects(service.createIntent({...input,policyMode:'unsupported'}),/not supported/);
    const [operation] = await sql`select id from company_recording_private_acl_operations where policy_id=${first.policyId} order by user_id limit 1`;
    const lease=await service.acquireLease(first.policyId,operation.id,30); assert.equal(lease.acquired,true); if (!lease.acquired) throw new Error('lease');
    const rival=await service.acquireLease(first.policyId,operation.id,30); assert.equal(rival.acquired,false);
    await assert.rejects(service.recordResult({policyId:first.policyId,operationId:operation.id,token:lease.token,fencingEpoch:lease.fencingEpoch+1,state:'applied'}),/Stale/);
    await service.recordResult({policyId:first.policyId,operationId:operation.id,token:lease.token,fencingEpoch:lease.fencingEpoch,state:'applied',permissionId:'permission-1'});
    const [saved] = await sql`select state,permission_id from company_recording_private_acl_operations where id=${operation.id}`; assert.equal(saved.state,'applied'); assert.equal(saved.permission_id,'permission-1');
    const drive = { grantReader: async (input: any) => { assert.equal(input.fileId,'drive_file_12345'); assert.equal(input.companyAccountEmail,'company@example.invalid'); return { permissionId:'permission-2', created:true }; }, revokeDirectReader: async (input: any) => { assert.equal(input.permissionId,'permission-2'); return { revoked:true }; } };
    const [secondOperation] = await sql`select id from company_recording_private_acl_operations where policy_id=${first.policyId} and id<>${operation.id}`;
    const granted = await service.grantReader(first.policyId, secondOperation.id, drive); assert.equal(granted.state,'applied'); assert.equal(granted.permissionId,'permission-2');
    const revoked = await service.revokeReader(first.policyId, secondOperation.id, drive); assert.equal(revoked.state,'revoked');
    const [audit] = await sql`select count(*)::int count from company_recording_private_acl_audit where policy_id=${first.policyId}`; assert.ok(Number(audit.count)>=3);
    await t.test('reconciliation result is durable and requires explicit resolution',async()=>{
      const [secondOp]=await sql`select id from company_recording_private_acl_operations where policy_id=${first.policyId} and id<>${operation.id}`;
      const next=await service.acquireLease(first.policyId,secondOp.id,30,true); assert.equal(next.acquired,true); if(!next.acquired)throw new Error('lease');
      await service.recordResult({policyId:first.policyId,operationId:secondOp.id,token:next.token,fencingEpoch:next.fencingEpoch,state:'reconciliation_required',failureCode:'PROVIDER_AMBIGUOUS'});
      const [policy]=await sql`select status,reconciliation_status from company_recording_private_policies where id=${first.policyId}`; assert.equal(policy.status,'reconciliation_required'); assert.equal(policy.reconciliation_status,'required');
      await service.markReconciled(first.policyId); const [resolved]=await sql`select status,reconciliation_status from company_recording_private_policies where id=${first.policyId}`; assert.equal(resolved.status,'pending'); assert.equal(resolved.reconciliation_status,'resolved');
    });
    await t.test('replacement refuses an in-flight prior ACL operation', async () => {
      const stale = await service.acquireLease(first.policyId, operation.id, 30, true);
      assert.equal(stale.acquired, true);
      if (!stale.acquired) throw new Error('lease');
      await assert.rejects(service.replaceIntent({ ...input, policyMode:'restricted', policyVersion: 2 }, async()=>input.recipients), /requires reconciliation/);
      await assert.rejects(service.markVerified(first.policyId, 1), /incomplete or fenced/);
    });
    await t.test('replacement and job mode change roll back together and an identical retry is idempotent', async () => {
      const nextMeeting=randomUUID(), nextJob=randomUUID(), nextRecording=randomUUID();
      await sql`insert into meetings(id,meeting_code,title,host_user_id,recording_access_policy,status) values (${nextMeeting},'YLM-ACL456','ACL test',${creator},'private','scheduled')`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id) values (${nextJob},${nextRecording},${creator},${nextMeeting},'folder_12345','private','video/webm',4,${'a'.repeat(64)},'drive_file_67890')`;
      const initial={...input,jobId:nextJob,meetingId:nextMeeting,recordingId:nextRecording,driveFileId:'drive_file_67890',recipients:[input.recipients[0]]};
      const oldPolicy=await service.createIntent(initial);
      const target={...initial,policyMode:'restricted',policyVersion:2};
      await assert.rejects(service.replaceIntent(target,async()=>{throw new Error('roster unavailable');}),/roster unavailable/);
      const [unchanged]=await sql`select j.access_policy,p.id,p.policy_version from company_recording_upload_jobs j join company_recording_private_policies p on p.job_id=j.id and p.is_active where j.id=${nextJob}`;
      assert.equal(unchanged.access_policy,'private'); assert.equal(unchanged.id,oldPolicy.policyId); assert.equal(Number(unchanged.policy_version),1);
      const replacement=await service.replaceIntent(target,async()=>initial.recipients);
      assert.notEqual(replacement.policyId,oldPolicy.policyId);
      const retry=await service.replaceIntent(target,async()=>initial.recipients);
      assert.equal(retry.idempotent,true); assert.equal(retry.policyId,replacement.policyId);
      const [active]=await sql`select j.access_policy,p.policy_mode,p.policy_version from company_recording_upload_jobs j join company_recording_private_policies p on p.job_id=j.id and p.is_active where j.id=${nextJob}`;
      assert.equal(active.access_policy,'restricted'); assert.equal(active.policy_mode,'restricted'); assert.equal(Number(active.policy_version),2);
    });
    await t.test('a replacement insert failure rolls back the mode update and supersession', async () => {
      const rollbackMeeting=randomUUID(), rollbackJob=randomUUID(), rollbackRecording=randomUUID();
      await sql`insert into meetings(id,meeting_code,title,host_user_id,recording_access_policy,status) values (${rollbackMeeting},'YLM-ACL789','ACL test',${creator},'private','scheduled')`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id) values (${rollbackJob},${rollbackRecording},${creator},${rollbackMeeting},'folder_12345','private','video/webm',4,${'a'.repeat(64)},'drive_file_98765')`;
      const initial={...input,jobId:rollbackJob,recordingId:rollbackRecording,driveFileId:'drive_file_98765',recipients:[input.recipients[0]]};
      const original=await service.createIntent(initial);
      // A conflicting historical version exercises failure after the job update;
      // it is a pending fixture, not a fabricated verified policy.
      await sql`insert into company_recording_private_policies(job_id,recording_id,drive_file_id,destination_folder_id,company_account_email,credential_generation,policy_mode,policy_version,is_active) select job_id,recording_id,drive_file_id,destination_folder_id,company_account_email,credential_generation,'restricted',2,false from company_recording_private_policies where id=${original.policyId}`;
      await assert.rejects(service.replaceIntent({...initial,policyMode:'restricted',policyVersion:2},async()=>initial.recipients));
      const [unchanged]=await sql`select j.access_policy,p.id,p.policy_version from company_recording_upload_jobs j join company_recording_private_policies p on p.job_id=j.id and p.is_active where j.id=${rollbackJob}`;
      assert.equal(unchanged.access_policy,'private'); assert.equal(unchanged.id,original.policyId); assert.equal(Number(unchanged.policy_version),1);
    });
  } finally { await sql.end({timeout:5}); }
});

test('stateful Drive mode changes use durable authoritative policies', { timeout: 120000 }, async t => {
  if (!parsed || parsed.protocol !== 'postgres:' || !['127.0.0.1','localhost'].includes(parsed.hostname) || process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused' || !/^ylaam_phase6c_test_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw new Error('Unsafe disposable target');
  const sql = postgres(url, { max: 8 });
  try {
    const [database] = await sql`select current_database() name,inet_server_addr()::text host`;
    assert.equal(database.name, parsed.pathname.slice(1)); assert.equal(database.host, '127.0.0.1/32');
    const { CompanyRecordingPrivateAclService } = await import('../../src/services/company-recording-private-acl.service.js');
    const { CompanyRecordingPrivateAclWorker } = await import('../../src/services/company-recording-private-acl-worker.js');
    const { CompanyRecordingPrivateAclPipelineAdapter } = await import('../../src/services/company-recording-private-acl-pipeline-adapter.js');
    const { CompanyRecordingPrivatePolicyIntentBuilder } = await import('../../src/services/company-recording-private-policy-intent-builder.js');
    const { CompanyRecordingDriveFileInspector } = await import('../../src/services/company-recording-drive-file-inspector.js');
    const { CompanyRecordingSharingRuntimeService } = await import('../../src/services/company-recording-sharing-runtime.service.js');
    const { CompanyRecordingAnyoneConfirmationService } = await import('../../src/services/company-recording-anyone-confirmation.service.js');
    const host=randomUUID(), student=randomUUID(), meeting=randomUUID(), job=randomUUID(), recording=randomUUID(), enrollment=randomUUID(), generation=randomUUID();
    const folder='batch_folder_12345', file='drive_file_switch_12345', company='company@example.invalid', hostEmail='switch-host@example.invalid', studentEmail='switch-student@example.invalid';
    await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values (${host},${hostEmail},'x','Host',now()),(${student},${studentEmail},'x','Student',now())`;
    await sql`insert into student_google_identities(user_id,google_subject,google_email,verified_at) values (${host},'switch-host-sub',${hostEmail},now()),(${student},'switch-student-sub',${studentEmail},now())`;
    await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values (${folder},'Batch',${host})`;
    await sql`insert into batch_student_enrollments(id,folder_id,student_name,student_email,status,approved_by) values (${enrollment},${folder},'Student',${studentEmail},'approved',${host})`;
    await sql`insert into batch_enrollment_account_bindings(enrollment_id,user_id) values (${enrollment},${student})`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id,recording_access_policy,recording_folder_id,status) values (${meeting},'YLM-SWITCH','Switch',${host},'private',${folder},'scheduled')`;
    await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id) values (${job},${recording},${host},${meeting},${folder},'private','video/webm',4,${'a'.repeat(64)},${file})`;
    await sql`update drive_integration_generation set generation=${generation} where id=1`;
    await sql`insert into drive_integration_credentials(id,google_account_email,encrypted_refresh_token,connected_by_user_id) values (1,${company},'mock-only',${host})`;
    type Permission = {id:string;type:string;role:string;emailAddress?:string};
    const permissions:Permission[]=[{id:'owner-permission',type:'user',role:'owner',emailAddress:company}];
    const events:string[]=[];
    let next=0, failRevocation=false, failInspection=false;
    const drive = {
      async listPermissions() { return permissions.map(p=>({...p})); },
      async grantReader(input:{email:string}) { let p=permissions.find(x=>x.emailAddress===input.email); if(!p){p={id:`reader-${++next}`,type:'user',role:'reader',emailAddress:input.email};permissions.push(p);events.push(`grant:${input.email}`);} return {permissionId:p.id,created:true}; },
      async grantAnyoneReader() { let p=permissions.find(x=>x.type==='anyone'); if(!p){p={id:`public-${++next}`,type:'anyone',role:'reader'};permissions.push(p);events.push('grant:public');} return {permissionId:p.id,created:true}; },
      async revokeDirectReader(input:{permissionId:string}) { if(failRevocation) throw new Error('ambiguous revocation'); const index=permissions.findIndex(x=>x.id===input.permissionId); if(index>=0){events.push(`revoke:${permissions[index].type}:${permissions[index].emailAddress ?? ''}`);permissions.splice(index,1);} return {revoked:true}; },
      async revokePermission(input:{permissionId:string}) { return drive.revokeDirectReader(input); },
    };
    const inspector=new CompanyRecordingDriveFileInspector(async (request:any) => {
      const endpoint=new URL(String(request));
      if(endpoint.pathname.endsWith('/permissions')) { events.push('inspect'); return Response.json({permissions:failInspection ? [...permissions,{id:'unexpected',type:'user',role:'reader',emailAddress:'unexpected@example.invalid'}] : permissions}); }
      return Response.json({id:file,size:'4',mimeType:'video/webm',parents:[folder],trashed:false,sha256Checksum:'a'.repeat(64),ownedByMe:true,version:'1',owners:[{emailAddress:company}],inheritedPermissionsDisabled:false});
    });
    const acl=new CompanyRecordingPrivateAclService(sql), worker=new CompanyRecordingPrivateAclWorker(acl);
    const access=async()=>({accountEmail:company,credentialGeneration:generation,accessToken:'test-only'});
    const validateDestination=async()=>({status:'SAFE',destinationId:folder});
    const builder=new CompanyRecordingPrivatePolicyIntentBuilder(sql,acl,{account:access,validateDestination});
    const pipeline=new CompanyRecordingPrivateAclPipelineAdapter(sql,acl,access,inspector,drive as any);
    const runtime=new CompanyRecordingSharingRuntimeService(acl,worker,pipeline,{sql,assertReady:()=>{},validateDestination,access,resolveRecipients:(tx,id,owner,mode)=>builder.resolveReplacementRecipients(tx,id,owner,mode),drive});
    const initial=await acl.createIntent({jobId:job,recordingId:recording,driveFileId:file,destinationFolderId:folder,companyAccountEmail:company,credentialGeneration:generation,policyMode:'private',policyVersion:1,creatorId:host,hostId:host,durableHostIds:[host],recipients:[{userId:host,kind:'creator',authorized:true,googleSubject:'switch-host-sub',googleEmail:hostEmail}]});
    assert.equal((await pipeline.reconcileForJob(job,host)).state,'verified');
    await t.test('Private to Restricted resolves and grants the approved roster',async()=>{
      await assert.rejects(runtime.requestChange(job,student,'restricted',1),/not authorized/);
      await assert.rejects(runtime.requestChange(job,host,'restricted',99),/stale/);
      const result=await runtime.requestChange(job,host,'restricted',1); assert.equal(result.state,'verified');
      const readers=await sql`select user_id from company_recording_private_readers where policy_id=${result.replacement.policyId} order by user_id`;
      assert.deepEqual(readers.map(r=>r.user_id).sort(),[host,student].sort());
      assert.deepEqual(permissions.filter(p=>p.role==='reader').map(p=>p.emailAddress).sort(),[hostEmail,studentEmail].sort());
      assert.ok(events.some(e=>e.startsWith('revoke:user:'))); assert.ok(events.filter(e=>e==='inspect').length>=2);
    });
    await t.test('Restricted to Anyone requires exact version confirmation',async()=>{
      await assert.rejects(runtime.requestChange(job,host,'anyone_with_link',2),/confirmation/);
      await new CompanyRecordingAnyoneConfirmationService(sql).confirm(job,host,3);
      const result=await runtime.requestChange(job,host,'anyone_with_link',2); assert.equal(result.state,'verified');
      assert.deepEqual(permissions.filter(p=>p.role==='reader').map(p=>p.type),['anyone']);
      const [confirmation]=await sql`select consumed_at from company_recording_anyone_confirmations where job_id=${job} and policy_version=3`; assert.ok(confirmation.consumed_at);
    });
    await t.test('Anyone to Private revokes public access before independent verification',async()=>{
      events.length=0;
      const result=await runtime.requestChange(job,host,'private',3); assert.equal(result.state,'verified');
      assert.equal(permissions.some(p=>p.type==='anyone'),false); assert.deepEqual(permissions.filter(p=>p.role==='reader').map(p=>p.emailAddress),[hostEmail]);
      assert.ok(events.indexOf('revoke:anyone:')>=0); assert.ok(events.lastIndexOf('inspect')>events.indexOf('revoke:anyone:'));
      const [policy]=await sql`select status,drive_file_id from company_recording_private_policies where id=${result.replacement.policyId}`; assert.equal(policy.status,'verified'); assert.equal(policy.drive_file_id,file);
      assert.equal((await runtime.requestChange(job,host,'private',3)).state,'verified');
    });
    await t.test('failed final inspection and ambiguous revocation do not verify',async()=>{
      failRevocation=true;
      const result=await runtime.requestChange(job,host,'restricted',4); assert.equal(result.state,'reconciliation_required');
      const [policy]=await sql`select status from company_recording_private_policies where id=${result.replacement.policyId}`; assert.notEqual(policy.status,'verified');
      failRevocation=false; failInspection=true;
      const retry=await runtime.requestChange(job,host,'restricted',4); assert.notEqual(retry.state,'verified');
      const [after]=await sql`select status from company_recording_private_policies where id=${result.replacement.policyId}`; assert.notEqual(after.status,'verified');
      failInspection=false;
      const recovered=await runtime.requestChange(job,host,'restricted',4); assert.equal(recovered.state,'verified');
      assert.equal(recovered.replacement.policyId,result.replacement.policyId);
    });
    await t.test('roster removal waits for the snapshot and invalidates its policy',async()=>{
      const otherJob=randomUUID(), otherRecording=randomUUID();
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id) values (${otherJob},${otherRecording},${host},${meeting},${folder},'private','video/webm',4,${'a'.repeat(64)},'drive_file_race_12345')`;
      const input={jobId:otherJob,recordingId:otherRecording,driveFileId:'drive_file_race_12345',destinationFolderId:folder,companyAccountEmail:company,credentialGeneration:generation,policyMode:'private',policyVersion:1,creatorId:host,hostId:host,durableHostIds:[host],recipients:[{userId:host,kind:'creator' as const,authorized:true,googleSubject:'switch-host-sub',googleEmail:hostEmail}]};
      await acl.createIntent(input);
      let signalSnapshot!:()=>void, releaseSnapshot!:()=>void;
      const snapshotTaken=new Promise<void>(resolve=>{signalSnapshot=resolve;});
      const allowCommit=new Promise<void>(resolve=>{releaseSnapshot=resolve;});
      const replacement=acl.replaceIntent({...input,policyMode:'restricted',policyVersion:2},async(tx,mode)=>{
        const readers=await builder.resolveReplacementRecipients(tx,otherJob,host,mode);
        signalSnapshot(); await allowCommit; return readers;
      });
      await snapshotTaken;
      process.env.JWT_SECRET ||= 'disposable-test-only';
      const { BatchStudentEnrollmentService }=await import('../../src/services/batch-student-enrollment.service.js');
      const { client }=await import('../../src/db/index.js');
      try {
        const removal=new BatchStudentEnrollmentService(host).transition(folder,enrollment,'remove',host);
        try {
          assert.equal(await Promise.race([removal.then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),150))]),false);
        } finally { releaseSnapshot(); }
        const policy=await replacement; await removal;
        const [saved]=await sql`select status,reconciliation_status from company_recording_private_policies where id=${policy.policyId}`;
        assert.equal(saved.status,'reconciliation_required'); assert.equal(saved.reconciliation_status,'required');
        const [reader]=await sql`select user_id from company_recording_private_readers where policy_id=${policy.policyId} and user_id=${student}`;
        assert.equal(reader.user_id,student);
      } finally { await client.end({timeout:5}); }
    });
    assert.ok(initial.policyId);
  } finally { await sql.end({timeout:5}); }
});
