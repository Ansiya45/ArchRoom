import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { CompanyRecordingDriveIntentService } from '../../src/services/company-recording-drive-intent.service.js';
import { CompanyRecordingResumableTransport } from '../../src/services/company-recording-resumable-transport.js';
import { CompanyRecordingTransferWorker } from '../../src/services/company-recording-transfer-worker.js';
import { CompanyRecordingDriveVerificationService } from '../../src/services/company-recording-drive-verification.service.js';
import { CompanyRecordingHistoryPublicationService } from '../../src/services/company-recording-history-publication.service.js';
import { CompanyRecordingUploadOrchestrator } from '../../src/services/company-recording-upload-orchestrator.js';
import { LocalRecordingIngestion } from '../../src/services/local-recording-ingestion.service.js';

const url='postgres://ylaam_test_admin@127.0.0.1:55453/ylaam_staging_disposable_5d2c';
test('0021 isolated fenced Drive media worker', {timeout:120000},async t=>{
  assert.equal(process.env.DATABASE_URL,url);assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DOTENV_CONFIG_PATH,'tests/.unused');
  console.log('Disposable target: host=127.0.0.1 port=55453 database=ylaam_staging_disposable_5d2c');
  const sql=postgres(url,{max:3}),other=postgres(url,{max:3});let closeApp=async()=>{};
  try {
    const [identity]=await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    assert.equal(identity.name,'ylaam_staging_disposable_5d2c');assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55453);
    assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(),'d:/development/archroom/.codex-pg-verification-5d2c');
    assert.equal((await sql`select to_regclass('public.users') as value`)[0].value,null);
    await migrateDatabase(url);await migrateDatabase(url);
    assert.equal((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n,23);
    const {CompanyRecordingJobsService}=await import('../../src/services/company-recording-jobs.service.js');
    const {recordingDriveRootId}=await import('../../src/config/recordingDrive.js');
    const {client}=await import('../../src/db/index.js');closeApp=()=>client.end({timeout:5});
    const {env}=await import('../../src/env.js');assert.equal(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,false);assert.equal(env.LOCAL_RECORDING_STAGING_ENABLED,false);
    const owner=randomUUID(),otherUser=randomUUID(),meeting=randomUUID();
    await sql`insert into users(id,email,password_hash,full_name) values(${owner},'worker-owner@example.invalid','test','Owner'),(${otherUser},'worker-other@example.invalid','test','Other')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values(${meeting},'YLM-WORKER','Worker test',${owner})`;
    let privacy:'SAFE'|'BLOCKED'|'UNVERIFIABLE'='SAFE',account='company@example.invalid',generation=randomUUID(),accessToken='mock-access';
    const seenAccessTokens:string[]=[];
    let remote=Buffer.alloc(0),filePresent=false,expire=false,loseAck=false,wrongFile=false,createCount=0,allocateCount=0,sendCount=0;
    let holdQuery:Promise<void>|null=null,queryEntered:()=>void=()=>{};
    let holdInitiation:Promise<void>|null=null,initiationEntered:()=>void=()=>{};
    const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=worker_session_123';
    const fakeFetch:typeof fetch=async (target,init)=>{
      const path=String(target),headers=init?.headers as Record<string,string>;
      seenAccessTokens.push(headers.Authorization);
      if(path.includes('generateIds')) return new Response(JSON.stringify({ids:['allocatedFile'+String(++allocateCount).padStart(3,'0')]}),{status:200});
      if(init?.method==='POST'){createCount++;initiationEntered();if(holdInitiation)await holdInitiation;return new Response(null,{status:200,headers:{Location:session}});}
      if(path.includes('/drive/v3/files/')) return filePresent ? new Response(JSON.stringify({id:wrongFile?'unexpectedId999':path.match(/\/files\/([^?]+)/)?.[1]}),{status:200}) : new Response(null,{status:404});
      if(init?.method==='PUT' && headers['Content-Range'].startsWith('bytes */')){
        queryEntered();if(holdQuery) await holdQuery;
        if(expire) return new Response(null,{status:410});
        if(filePresent) return new Response(null,{status:200});
        return new Response(null,{status:308,headers:remote.length?{Range:`bytes=0-${remote.length-1}`}:{}});
      }
      if(init?.method==='PUT'){
        sendCount++;
        const start=Number(/^bytes (\d+)-/.exec(headers['Content-Range'])?.[1]);
        assert.equal(start,remote.length);
        remote=Buffer.concat([remote,Buffer.from(init.body as Uint8Array)]);
        if(remote.length===Number(headers['Content-Range'].split('/')[1])) filePresent=true;
        if(loseAck){loseAck=false;throw new Error('Mock response lost after provider accepted bytes');}
        return filePresent?new Response(null,{status:200}):new Response(null,{status:308,headers:{Range:`bytes=0-${remote.length-1}`}});
      }
      throw new Error('Unexpected mock request');
    };
    const transport=new CompanyRecordingResumableTransport(fakeFetch),config={nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:url};
    const jobs=new CompanyRecordingJobsService(true,async()=>privacy==='SAFE'?{status:'SAFE' as const,
      destinationId:(await sql`select recording_folder_id from meetings where id=${meeting}`)[0].recording_folder_id??recordingDriveRootId(),checkedAt:'test'}:{status:privacy,reason:'mock'});
    const authorize=(id:string,user:string)=>jobs.status(id,user);
    const gate=(id:string,user:string)=>jobs.validateImmediatelyBeforeFileCreation(id,user);
    const access=async()=>({accountEmail:account,credentialGeneration:generation,accessToken});
    const key=randomBytes(32);
    const intent=new CompanyRecordingDriveIntentService(sql,config,authorize,gate,access,transport,key);
    const secondIntent=new CompanyRecordingDriveIntentService(other,config,authorize,gate,access,transport,key);
    const worker=new CompanyRecordingTransferWorker(sql,config,authorize,gate,access,intent,transport);
    const second=new CompanyRecordingTransferWorker(other,config,authorize,gate,access,secondIntent,transport);
    let inspection:'SAFE'|'BLOCKED'|'UNVERIFIABLE'='SAFE';
    let holdInspection:Promise<void>|null=null,inspectionEntered:()=>void=()=>{};
    const fakeInspector={inspect:async(_token:string,input:any)=>{inspectionEntered();if(holdInspection)await holdInspection;return inspection==='SAFE'?{status:'SAFE' as const,fileId:input.fileId,destinationId:input.destinationId,size:input.byteLength,mimeType:input.mimeType,sha256:input.sha256,checkedAt:'test'}: {status:inspection,reason:'mock'};}} as any;
    const verifier=new CompanyRecordingDriveVerificationService(sql,config,authorize,gate,access,fakeInspector);
    const secondVerifier=new CompanyRecordingDriveVerificationService(other,config,authorize,gate,access,fakeInspector);
    const publisher=new CompanyRecordingHistoryPublicationService(sql,config,authorize,gate,access,fakeInspector);
    const secondPublisher=new CompanyRecordingHistoryPublicationService(other,config,authorize,gate,access,fakeInspector);
    const ingest=new LocalRecordingIngestion(sql,config,authorize);
    const orchestrator=new CompanyRecordingUploadOrchestrator(sql,config,jobs,intent,worker,verifier,publisher,ingest);
    const secondIngest=new LocalRecordingIngestion(other,config,authorize);
    const secondOrchestrator=new CompanyRecordingUploadOrchestrator(other,config,jobs,secondIntent,second,secondVerifier,secondPublisher,secondIngest);
    const fixture=async(data:Buffer,folder:string|null=null)=>{
      await sql`update meetings set recording_folder_id=${folder} where id=${meeting}`;
      const jobId=randomUUID(),recordingId=randomUUID();
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256)
        values(${jobId},${recordingId},${owner},${meeting},${folder??recordingDriveRootId()},'private','video/webm',${data.length},${createHash('sha256').update(data).digest('hex')})`;
      return {jobId,recordingId,data};
    };
    const stage=async(f:Awaited<ReturnType<typeof fixture>>)=>{
      if(f.data.length>262144){await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-262143/${f.data.length}`,f.data.subarray(0,262144));
        await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 262144-${f.data.length-1}/${f.data.length}`,f.data.subarray(262144));}
      else await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-${f.data.length-1}/${f.data.length}`,f.data);
      await ingest.verify({jobId:f.jobId,recordingId:f.recordingId,userId:owner});
      await intent.reserve(f.jobId,owner);await intent.beginSession(f.jobId,owner);
    };
    const data=Buffer.concat([Buffer.alloc(262144,17),Buffer.from('end')]);
    const first=await fixture(data);
    await t.test('disabled flags, unauthorized and unverified data never send',async()=>{
      const disabled=new CompanyRecordingTransferWorker(sql,{...config,jobsEnabled:false},authorize,gate,access,intent,transport);
      await assert.rejects(disabled.step(first.jobId,owner));
      const disabledPipeline=new CompanyRecordingUploadOrchestrator(sql,{...config,jobsEnabled:false},jobs,intent,worker,verifier,publisher,ingest);
      await assert.rejects(disabledPipeline.request(first.jobId,owner));
      await assert.rejects(worker.step(first.jobId,otherUser));
      await assert.rejects(orchestrator.request(first.jobId,otherUser));
      await assert.rejects(orchestrator.retry(first.jobId,owner));
      await assert.rejects(worker.step(first.jobId,owner));assert.equal(sendCount,0);
    });
    await stage(first);
    await t.test('privacy and credential changes block transfer',async()=>{
      privacy='BLOCKED';await assert.rejects(worker.step(first.jobId,owner));
      privacy='UNVERIFIABLE';await assert.rejects(worker.step(first.jobId,owner));privacy='SAFE';
      generation=randomUUID();await assert.rejects(worker.step(first.jobId,owner));
      generation=(await sql`select credential_generation from company_recording_transfer_intents where job_id=${first.jobId}`)[0].credential_generation;
      account='switched@example.invalid';await assert.rejects(worker.step(first.jobId,owner));account='company@example.invalid';
      assert.equal(sendCount,0);
    });
    await t.test('concurrent workers, ordered canonical chunks, confirmed offsets and no completion',async()=>{
      let release!:()=>void,entered!:()=>void;
      holdQuery=new Promise<void>(resolve=>{release=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});queryEntered=entered;
      const running=worker.step(first.jobId,owner);await seen;
      assert.equal((await second.step(first.jobId,owner)).state,'busy');release();holdQuery=null;queryEntered=()=>{};
      assert.deepEqual(await running,{state:'progress',offset:262144});
      assert.equal(Number((await sql`select drive_confirmed_offset from company_recording_transfer_intents where job_id=${first.jobId}`)[0].drive_confirmed_offset),262144);
      accessToken='rotated-access';
      assert.deepEqual(await second.step(first.jobId,owner),{state:'awaiting_drive_verification',offset:data.length});
      assert.ok(seenAccessTokens.includes('Bearer rotated-access'));
      assert.deepEqual(remote,data);assert.equal(sendCount,2);assert.equal(createCount,1);
      const [job]=await sql`select state,confirmed_offset from company_recording_upload_jobs where id=${first.jobId}`;
      assert.equal(job.state,'pending');assert.equal(Number(job.confirmed_offset),0);
      assert.equal((await sql`select count(*)::int as n from meeting_history_items`)[0].n,0);
      assert.equal((await sql`select count(*)::int as n from local_recording_staging.chunks`)[0].n,2);
    });
    await t.test('independent verification is fenced, durable and does not complete or publish',async()=>{
      const firstAttempt=verifier.verify(first.jobId,owner);
      const secondAttempt=secondVerifier.verify(first.jobId,owner);
      const outcomes=await Promise.all([firstAttempt,secondAttempt]);
      assert.ok(outcomes.some(value=>value.state==='verified'));
      assert.ok(outcomes.every(value=>value.state==='verified'||value.state==='busy'));
      const [record]=await sql`select outcome,drive_file_id,expected_sha256 from company_recording_drive_verifications where job_id=${first.jobId}`;
      assert.equal(record.outcome,'verified');assert.equal(record.drive_file_id,(await sql`select drive_file_id from company_recording_transfer_intents where job_id=${first.jobId}`)[0].drive_file_id);
      assert.equal((await sql`select state from company_recording_upload_jobs where id=${first.jobId}`)[0].state,'pending');
      assert.equal((await sql`select count(*)::int as n from meeting_history_items`)[0].n,0);
      inspection='BLOCKED';assert.deepEqual(await verifier.verify(first.jobId,owner),{state:'blocked'});inspection='SAFE';
      assert.equal((await sql`select outcome from company_recording_drive_verifications where job_id=${first.jobId}`)[0].outcome,'blocked');
      await assert.rejects(verifier.verify(first.jobId,otherUser));
    });
    await t.test('only a freshly private verified file publishes once and completes atomically',async()=>{
      inspection='SAFE';assert.deepEqual(await verifier.verify(first.jobId,owner),{state:'verified'});
      privacy='BLOCKED';await assert.rejects(publisher.publish(first.jobId,owner));privacy='SAFE';
      const results=await Promise.all([publisher.publish(first.jobId,owner),secondPublisher.publish(first.jobId,owner)]);
      assert.ok(results.some(result=>result.state==='published'));
      assert.ok(results.some(result=>result.state==='busy')||results.some(result=>result.state==='published'));
      assert.equal((await sql`select state,verified_drive_file_id from company_recording_upload_jobs where id=${first.jobId}`)[0].state,'completed');
      assert.equal((await sql`select count(*)::int as n from meeting_history_items where meeting_id=${meeting}`)[0].n,1);
      assert.equal((await sql`select count(*)::int as n from local_recording_staging.chunks`)[0].n,2);
      await assert.rejects(publisher.publish(first.jobId,owner));
    });
    await t.test('request processing completes asynchronously from durable ingested bytes and status is server-confirmed',async()=>{
      const f=await fixture(Buffer.from('orchestrated recording'));remote=Buffer.alloc(0);filePresent=false;
      await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-${f.data.length-1}/${f.data.length}`,f.data);
      assert.equal((await orchestrator.status(f.jobId,owner)).stage,'verifying_canonical_bytes');
      const accepted=await orchestrator.request(f.jobId,owner);assert.equal(accepted.accepted,true);
      const concurrent=await secondOrchestrator.request(f.jobId,owner);assert.equal(concurrent.accepted,true);
      let current=await orchestrator.status(f.jobId,owner);
      for(let n=0;n<100&&current.stage!=='completed';n++){await new Promise(resolve=>setTimeout(resolve,10));current=await orchestrator.status(f.jobId,owner);}
      assert.equal(current.stage,'completed');assert.equal(current.stagedBytes,f.data.length);assert.equal(current.driveConfirmedBytes,f.data.length);
      assert.equal((await sql`select count(*)::int as n from meeting_history_items where meeting_id=${meeting}`)[0].n,2);
      assert.deepEqual(remote,f.data);
    });
    await t.test('a new backend orchestrator resumes durable work after restart without a browser request',async()=>{
      const f=await fixture(Buffer.from('restart durable'));remote=Buffer.alloc(0);filePresent=false;
      await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-${f.data.length-1}/${f.data.length}`,f.data);
      secondOrchestrator.schedule(f.jobId,owner);
      let current=await orchestrator.status(f.jobId,owner);
      for(let n=0;n<100&&current.stage!=='completed';n++){await new Promise(resolve=>setTimeout(resolve,10));current=await orchestrator.status(f.jobId,owner);}
      assert.equal(current.stage,'completed');assert.deepEqual(remote,f.data);
    });
    await t.test('lost acknowledgment and process restart reconcile Drive offset without duplicate bytes',async()=>{
      remote=Buffer.alloc(0);filePresent=false;sendCount=0;const f=await fixture(data);await stage(f);
      loseAck=true;await assert.rejects(worker.step(f.jobId,owner));assert.equal(remote.length,262144);
      const restarted=new CompanyRecordingTransferWorker(other,config,authorize,gate,access,secondIntent,transport);
      assert.deepEqual(await restarted.step(f.jobId,owner),{state:'awaiting_drive_verification',offset:data.length});
      assert.deepEqual(remote,data);assert.equal(sendCount,2);
    });
    await t.test('expired session and missing file remain in reconciliation without creating a second session',async()=>{
      remote=Buffer.alloc(0);filePresent=false;expire=false;const f=await fixture(Buffer.from('abc'));await stage(f);
      expire=true;assert.equal((await worker.step(f.jobId,owner)).state,'reconciliation_required');
      assert.equal((await second.step(f.jobId,owner)).state,'reconciliation_required');
      assert.equal(sendCount,2);expire=false;
    });
    await t.test('lost final response is reconciled by the saved Drive file ID',async()=>{
      remote=Buffer.alloc(0);filePresent=false;const f=await fixture(Buffer.from('final'));await stage(f);
      loseAck=true;await assert.rejects(worker.step(f.jobId,owner));
      assert.equal(remote.toString(),'final');
      assert.equal((await second.step(f.jobId,owner)).state,'awaiting_drive_verification');
      assert.equal((await sql`select state from company_recording_upload_jobs where id=${f.jobId}`)[0].state,'pending');
    });
    await t.test('lost initiation response and unexpected Drive ID fail closed',async()=>{
      const f=await fixture(Buffer.from('abc'));await stage(f);
      await sql`update company_recording_transfer_intents set encrypted_session=null where job_id=${f.jobId}`;
      filePresent=false;assert.equal((await worker.step(f.jobId,owner)).state,'reconciliation_required');
      filePresent=true;wrongFile=true;await assert.rejects(second.step(f.jobId,owner));wrongFile=false;filePresent=false;
      assert.equal((await sql`select transfer_state from company_recording_transfer_intents where job_id=${f.jobId}`)[0].transfer_state,'reconcile_required');
    });
    await t.test('database failure preserves Drive-confirmed bytes for later reconciliation; stale fencing blocks writes',async()=>{
      const f=await fixture(Buffer.from('abc'));await stage(f);remote=Buffer.alloc(0);filePresent=false;
      await sql`alter table company_recording_transfer_intents add constraint test_fail_offset check(drive_confirmed_offset=0) not valid`;
      try {await assert.rejects(worker.step(f.jobId,owner));}finally{await sql`alter table company_recording_transfer_intents drop constraint test_fail_offset`;}
      assert.equal(remote.toString(),'abc');assert.equal((await second.step(f.jobId,owner)).state,'awaiting_drive_verification');
      const before=Number((await sql`select lease_epoch from company_recording_transfer_intents where job_id=${f.jobId}`)[0].lease_epoch);
      assert.ok(before>=2);
      // Earlier independent publication and both orchestration runs produced one item each;
      // this failed transfer must not add another one.
      assert.equal((await sql`select count(*)::int as n from meeting_history_items`)[0].n,3);
      const stale=await fixture(Buffer.from('xyz'));await stage(stale);
      remote=Buffer.alloc(0);filePresent=false;
      let resume!:()=>void,entered!:()=>void;
      holdQuery=new Promise<void>(resolve=>{resume=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});queryEntered=entered;
      const oldWorker=worker.step(stale.jobId,owner);await seen;
      await other`update company_recording_transfer_intents set lease_token=${randomUUID()},lease_epoch=lease_epoch+1,lease_until=now()+interval '90 seconds' where job_id=${stale.jobId}`;
      resume();holdQuery=null;queryEntered=()=>{};
      await assert.rejects(oldWorker);
      assert.equal((await sql`select drive_confirmed_offset from company_recording_transfer_intents where job_id=${stale.jobId}`)[0].drive_confirmed_offset,'0');
      assert.equal(sendCount,4);
    });
    const awaiting=async(data:Buffer)=>{
      const f=await fixture(data);await stage(f);remote=Buffer.alloc(0);filePresent=false;
      assert.equal((await worker.step(f.jobId,owner)).state,'awaiting_drive_verification');
      return f;
    };
    await t.test('restart at verification boundary uses no media or session creation and publishes once',async()=>{
      const f=await awaiting(Buffer.from('verification recovery'));
      await sql`update company_recording_transfer_intents set encrypted_session=null where job_id=${f.jobId}`;
      const before={createCount,allocateCount,sendCount};
      const outcomes=await Promise.allSettled([orchestrator.process(f.jobId,owner),secondOrchestrator.process(f.jobId,owner)]);
      assert.ok(outcomes.some(result=>result.status==='fulfilled'&&result.value.state==='published'));
      assert.deepEqual({createCount,allocateCount,sendCount},before);
      assert.equal((await sql`select state from company_recording_upload_jobs where id=${f.jobId}`)[0].state,'completed');
      assert.equal((await sql`select count(*)::int as n from meeting_history_items where dedupe_key=${`company-drive:${f.recordingId}`}`)[0].n,1);
      assert.equal((await sql`select count(*)::int as n from local_recording_staging.chunks c join local_recording_staging.recordings r on r.id=c.staging_id where r.source_job_id=${f.jobId}`)[0].n,1);
    });
    await t.test('restart after durable verification rechecks and publishes without transfer',async()=>{
      const f=await awaiting(Buffer.from('verified before restart'));
      assert.equal((await verifier.verify(f.jobId,owner)).state,'verified');
      const before={createCount,allocateCount,sendCount};
      assert.equal((await secondOrchestrator.process(f.jobId,owner)).state,'published');
      assert.deepEqual({createCount,allocateCount,sendCount},before);
      assert.equal((await sql`select count(*)::int as n from meeting_history_items where dedupe_key=${`company-drive:${f.recordingId}`}`)[0].n,1);
    });
    await t.test('orchestrator restart resumes partial transfer at Drive-confirmed offset',async()=>{
      const f=await fixture(data);await stage(f);remote=Buffer.alloc(0);filePresent=false;
      assert.deepEqual(await worker.step(f.jobId,owner),{state:'progress',offset:262144});
      const before={createCount,allocateCount,sendCount};
      assert.equal((await secondOrchestrator.process(f.jobId,owner)).state,'published');
      assert.equal(createCount,before.createCount);assert.equal(allocateCount,before.allocateCount);
      assert.equal(sendCount,before.sendCount+1);assert.deepEqual(remote,data);
    });
    await t.test('expired and superseded leases cannot insert a first verification',async()=>{
      for(const expired of [false,true]){
        const f=await awaiting(Buffer.from(expired?'expired lease':'superseded lease'));
        let resume!:()=>void,entered!:()=>void;
        holdInspection=new Promise<void>(resolve=>{resume=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});inspectionEntered=entered;
        const pending=verifier.verify(f.jobId,owner);await seen;
        assert.equal((await secondVerifier.verify(f.jobId,owner)).state,'busy');
        if(expired) await other`update company_recording_transfer_intents set lease_until=clock_timestamp()-interval '1 second' where job_id=${f.jobId}`;
        else await other`update company_recording_transfer_intents set lease_token=${randomUUID()},lease_epoch=lease_epoch+1,lease_until=clock_timestamp()+interval '90 seconds' where job_id=${f.jobId}`;
        resume();holdInspection=null;inspectionEntered=()=>{};
        await assert.rejects(pending);
        assert.equal((await sql`select count(*)::int as n from company_recording_drive_verifications where job_id=${f.jobId}`)[0].n,0);
        assert.equal((await sql`select count(*)::int as n from meeting_history_items where dedupe_key=${`company-drive:${f.recordingId}`}`)[0].n,0);
      }
    });
    await t.test('lease expiry while an initial insert waits on a unique conflict rolls back',async()=>{
      const f=await awaiting(Buffer.from('blocked insertion'));
      let resumeInspector!:()=>void,enteredInspector!:()=>void,releaseBlocker!:()=>void,blockerReady!:()=>void;
      holdInspection=new Promise<void>(resolve=>{resumeInspector=resolve});const inspected=new Promise<void>(resolve=>{enteredInspector=resolve});inspectionEntered=enteredInspector;
      const pending=verifier.verify(f.jobId,owner).then(()=>false,()=>true);await inspected;
      const [intentRow]=await sql`select * from company_recording_transfer_intents where job_id=${f.jobId}`;
      const ready=new Promise<void>(resolve=>{blockerReady=resolve});const unblock=new Promise<void>(resolve=>{releaseBlocker=resolve});
      const blocker=other.begin(async tx=>{
        await tx`insert into company_recording_drive_verifications(job_id,recording_id,drive_file_id,destination_folder_id,expected_byte_length,expected_mime_type,expected_sha256,company_account_email,credential_generation,outcome)
          values(${f.jobId},${f.recordingId},${intentRow.drive_file_id},${intentRow.destination_folder_id},${f.data.length},'video/webm',${createHash('sha256').update(f.data).digest('hex')},${intentRow.company_account_email},${intentRow.credential_generation},'verified')`;
        blockerReady();await unblock;throw new Error('rollback test blocker');
      }).catch(()=>undefined);
      try {
        await ready;
        await sql`update company_recording_transfer_intents set lease_until=clock_timestamp()+interval '1 second' where job_id=${f.jobId}`;
        resumeInspector();holdInspection=null;inspectionEntered=()=>{};
        let blocked=false;
        for(let attempt=0;attempt<100&&!blocked;attempt++){
          const [row]=await other`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%insert into company_recording_drive_verifications%') as blocked`;
          blocked=row.blocked;if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(blocked,true);
        await new Promise(resolve=>setTimeout(resolve,1200));
      } finally {resumeInspector();holdInspection=null;inspectionEntered=()=>{};releaseBlocker();await blocker;}
      assert.equal(await pending,true);
      assert.equal((await sql`select count(*)::int as n from company_recording_drive_verifications where job_id=${f.jobId}`)[0].n,0);
    });
    await t.test('superseded conflict updates and failed writes preserve the prior verification',async()=>{
      const f=await awaiting(Buffer.from('conflict fencing'));
      assert.equal((await verifier.verify(f.jobId,owner)).state,'verified');
      let resume!:()=>void,entered!:()=>void;
      holdInspection=new Promise<void>(resolve=>{resume=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});inspectionEntered=entered;
      inspection='BLOCKED';const pending=verifier.verify(f.jobId,owner);await seen;
      await other`update company_recording_transfer_intents set lease_token=${randomUUID()},lease_epoch=lease_epoch+1,lease_until=clock_timestamp()+interval '90 seconds' where job_id=${f.jobId}`;
      resume();holdInspection=null;inspectionEntered=()=>{};await assert.rejects(pending);
      assert.equal((await sql`select outcome from company_recording_drive_verifications where job_id=${f.jobId}`)[0].outcome,'verified');
      await sql`update company_recording_transfer_intents set lease_token=null,lease_until=null where job_id=${f.jobId}`;
      await sql`alter table company_recording_drive_verifications add constraint test_fail_verification check(outcome <> 'blocked') not valid`;
      try {await assert.rejects(verifier.verify(f.jobId,owner));}finally{await sql`alter table company_recording_drive_verifications drop constraint test_fail_verification`;inspection='SAFE';}
      assert.equal((await sql`select outcome from company_recording_drive_verifications where job_id=${f.jobId}`)[0].outcome,'verified');
    });
    await t.test('live session creation stays preparing and a second orchestrator does not mark it abandoned',async()=>{
      const f=await fixture(Buffer.from('concurrent session creation'));
      await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-${f.data.length-1}/${f.data.length}`,f.data);
      await ingest.verify({jobId:f.jobId,recordingId:f.recordingId,userId:owner});await intent.reserve(f.jobId,owner);
      let release!:()=>void,entered!:()=>void;
      holdInitiation=new Promise<void>(resolve=>{release=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});initiationEntered=entered;
      const before=createCount;const pending=intent.beginSession(f.jobId,owner);await seen;
      try {
        assert.equal((await orchestrator.status(f.jobId,owner)).stage,'preparing_drive_upload');
        assert.equal((await secondOrchestrator.process(f.jobId,owner)).state,'busy');
        assert.equal((await sql`select state from company_recording_upload_jobs where id=${f.jobId}`)[0].state,'pending');
        assert.equal(createCount,before+1);
      } finally {release();holdInitiation=null;initiationEntered=()=>{};}
      await pending;
      const [saved]=await sql`select encrypted_session,lease_token from company_recording_transfer_intents where job_id=${f.jobId}`;
      assert.ok(saved.encrypted_session);assert.equal(saved.lease_token,null);
      remote=Buffer.alloc(0);filePresent=false;
      assert.equal((await secondOrchestrator.process(f.jobId,owner)).state,'published');
      assert.equal(createCount,before+1);
    });
    await t.test('a superseded session-creation lease cannot persist a late provider response',async()=>{
      const f=await fixture(Buffer.from('late session response'));
      await ingest.ingest({jobId:f.jobId,recordingId:f.recordingId,userId:owner},`bytes 0-${f.data.length-1}/${f.data.length}`,f.data);
      await ingest.verify({jobId:f.jobId,recordingId:f.recordingId,userId:owner});await intent.reserve(f.jobId,owner);
      let release!:()=>void,entered!:()=>void;
      holdInitiation=new Promise<void>(resolve=>{release=resolve});const seen=new Promise<void>(resolve=>{entered=resolve});initiationEntered=entered;
      const before=createCount;const pending=intent.beginSession(f.jobId,owner);await seen;
      await other`update company_recording_transfer_intents set lease_token=${randomUUID()},lease_epoch=lease_epoch+1,lease_until=clock_timestamp()-interval '1 second' where job_id=${f.jobId}`;
      release();holdInitiation=null;initiationEntered=()=>{};await assert.rejects(pending);
      const [saved]=await sql`select encrypted_session,session_creation_attempted from company_recording_transfer_intents where job_id=${f.jobId}`;
      assert.equal(saved.encrypted_session,null);assert.equal(saved.session_creation_attempted,true);
      assert.equal((await secondOrchestrator.process(f.jobId,owner)).state,'reconciliation_required');
      assert.equal((await orchestrator.status(f.jobId,owner)).stage,'manual_reconciliation');
      assert.equal(createCount,before+1);
    });
    console.log('PASS fenced worker, canonical bytes, Drive offsets, interruption, restart, privacy, uncertainty and no publication');
  }finally{await closeApp();await sql.end();await other.end();}
});
