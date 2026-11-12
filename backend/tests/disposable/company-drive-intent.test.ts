import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { CompanyRecordingDriveIntentService } from '../../src/services/company-recording-drive-intent.service.js';
import { CompanyRecordingResumableTransport } from '../../src/services/company-recording-resumable-transport.js';
import { LocalRecordingIngestion } from '../../src/services/local-recording-ingestion.service.js';

const url='postgres://ylaam_test_admin@127.0.0.1:55450/ylaam_staging_disposable_0020';
test('0020 isolated company Drive intent and encrypted session foundation', {timeout:120000},async t=>{
  assert.equal(process.env.DATABASE_URL,url);assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DOTENV_CONFIG_PATH,'tests/.unused');
  console.log('Disposable target: host=127.0.0.1 port=55450 database=ylaam_staging_disposable_0020');
  const sql=postgres(url,{max:3}),other=postgres(url,{max:3});
  let closeApp=async()=>{};
  try {
    const [identity]=await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    assert.equal(identity.name,'ylaam_staging_disposable_0020');assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55450);
    assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(),'d:/development/archroom/.codex-pg-drive-intent-0020');
    assert.equal((await sql`select to_regclass('public.users') as value`)[0].value,null);
    await migrateDatabase(url);await migrateDatabase(url);
    assert.equal((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n,23);
    const { CompanyRecordingJobsService }=await import('../../src/services/company-recording-jobs.service.js');
    const { recordingDriveRootId }=await import('../../src/config/recordingDrive.js');
    const { client }=await import('../../src/db/index.js');closeApp=()=>client.end({timeout:5});
    const { env }=await import('../../src/env.js');assert.equal(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,false);assert.equal(env.LOCAL_RECORDING_STAGING_ENABLED,false);
    const owner=randomUUID(),otherUser=randomUUID(),meeting=randomUUID();
    await sql`insert into users(id,email,password_hash,full_name) values(${owner},'owner@example.invalid','test','Owner'),(${otherUser},'other@example.invalid','test','Other')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values(${meeting},'YLM-INTENT','Test',${owner})`;
    const fixture=async(folder:string|null=null)=>{
      await sql`update meetings set recording_folder_id=${folder} where id=${meeting}`;
      const data=Buffer.from('canonical-original-bytes'),jobId=randomUUID(),recordingId=randomUUID();
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256)
        values(${jobId},${recordingId},${owner},${meeting},${folder??recordingDriveRootId()},'private','video/webm',${data.length},${createHash('sha256').update(data).digest('hex')})`;
      return {jobId,recordingId,data,folder:folder??recordingDriveRootId()};
    };
    let privacy:'SAFE'|'BLOCKED'|'UNVERIFIABLE'='SAFE', privacyCalls=0, allocateCalls=0, createCalls=0;
    const jobs=new CompanyRecordingJobsService(true,async()=>{privacyCalls++;return privacy==='SAFE'?
      {status:'SAFE' as const,destinationId:(await sql`select recording_folder_id from meetings where id=${meeting}`)[0].recording_folder_id??recordingDriveRootId(),checkedAt:'test'}:
      {status:privacy,reason:'mock blocked'};});
    const authorize=(id:string,user:string)=>jobs.status(id,user);
    const config={nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:url};
    const ingest=new LocalRecordingIngestion(sql,config,authorize);
    let generation=randomUUID(),account='company@example.invalid';
    const access=async()=>({accountEmail:account,credentialGeneration:generation,accessToken:'mock-access-token'});
    const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_001';
    const metadata:Array<any>=[];
    const fakeFetch:typeof fetch=async (target,init)=>{
      const requestUrl=String(target);
      if(requestUrl.includes('generateIds')){allocateCalls++;return new Response(JSON.stringify({ids:['allocatedFile'+String(allocateCalls).padStart(3,'0')]}),{status:200});}
      if(requestUrl.includes('/upload/drive/v3/files?uploadType=')){
        createCalls++;metadata.push(JSON.parse(String(init?.body)));
        return new Response(null,{status:200,headers:{Location:session}});
      }
      throw new Error('Unexpected network call');
    };
    const transport=new CompanyRecordingResumableTransport(fakeFetch);
    const key=randomBytes(32),service=new CompanyRecordingDriveIntentService(sql,config,authorize,(id,user)=>jobs.validateImmediatelyBeforeFileCreation(id,user),access,transport,key);
    const second=new CompanyRecordingDriveIntentService(other,config,authorize,(id,user)=>jobs.validateImmediatelyBeforeFileCreation(id,user),access,transport,key);
    const first=await fixture();
    await t.test('flag off, unauthorized, and unverified bytes cannot allocate or create',async()=>{
      const disabled=new CompanyRecordingDriveIntentService(sql,{...config,jobsEnabled:false},authorize,()=>{throw new Error('privacy called');},access,transport,key);
      await assert.rejects(disabled.reserve(first.jobId,owner));
      await assert.rejects(service.reserve(first.jobId,otherUser));
      await assert.rejects(service.reserve(first.jobId,owner));
      assert.equal(allocateCalls,0);assert.equal(createCalls,0);
    });
    await ingest.ingest({jobId:first.jobId,recordingId:first.recordingId,userId:owner},`bytes 0-${first.data.length-1}/${first.data.length}`,first.data);
    await ingest.verify({jobId:first.jobId,recordingId:first.recordingId,userId:owner});
    await t.test('BLOCKED and UNVERIFIABLE privacy cannot reserve or begin',async()=>{
      privacy='BLOCKED';await assert.rejects(service.reserve(first.jobId,owner));
      privacy='UNVERIFIABLE';await assert.rejects(service.reserve(first.jobId,owner));
      assert.equal(allocateCalls,0);privacy='SAFE';
    });
    await t.test('root intent, concurrent reservation, encrypted session and restart',async()=>{
      const [one,two]=await Promise.all([service.reserve(first.jobId,owner),second.reserve(first.jobId,owner)]);
      assert.equal(one.driveFileId,two.driveFileId);assert.equal(createCalls,0);
      const [intent]=await sql`select * from company_recording_transfer_intents where job_id=${first.jobId}`;
      assert.equal(intent.destination_folder_id,recordingDriveRootId());assert.equal(intent.company_account_email,account);
      privacy='BLOCKED';await assert.rejects(service.beginSession(first.jobId,owner));assert.equal(createCalls,0);privacy='SAFE';
      const started=await Promise.allSettled([service.beginSession(first.jobId,owner),second.beginSession(first.jobId,owner)]);
      assert.equal(started.filter(x=>x.status==='fulfilled').length,1);assert.equal(createCalls,1);
      assert.equal(metadata[0].id,one.driveFileId);assert.deepEqual(metadata[0].parents,[recordingDriveRootId()]);
      const [saved]=await sql`select encrypted_session,session_creation_attempted from company_recording_transfer_intents where job_id=${first.jobId}`;
      assert.ok(saved.session_creation_attempted);assert.ok(saved.encrypted_session?.startsWith('v1.'));assert.ok(!saved.encrypted_session.includes(session));
      const fresh=new CompanyRecordingDriveIntentService(other,config,authorize,(id,user)=>jobs.validateImmediatelyBeforeFileCreation(id,user),access,transport,key);
      assert.equal((await fresh.recoverSession(first.jobId,owner)).sessionUrl,session);
      assert.deepEqual(await fresh.readVerifiedChunk(first.jobId,owner,0),first.data);
      await assert.rejects(fresh.beginSession(first.jobId,owner));assert.equal(createCalls,1);
      const wrongKey=new CompanyRecordingDriveIntentService(other,config,authorize,(id,user)=>jobs.validateImmediatelyBeforeFileCreation(id,user),access,transport,randomBytes(32));
      await assert.rejects(wrongKey.recoverSession(first.jobId,owner));
    });
    await t.test('company account and credential generation changes block session recovery',async()=>{
      generation=randomUUID();await assert.rejects(service.recoverSession(first.jobId,owner));
      generation=(await sql`select credential_generation from company_recording_transfer_intents where job_id=${first.jobId}`)[0].credential_generation;
      account='switched@example.invalid';await assert.rejects(service.recoverSession(first.jobId,owner));
      account='company@example.invalid';
    });
    await t.test('selected folder and distinct recording cycle have separate file IDs',async()=>{
      const child=await fixture('approvedFolder123');
      await ingest.ingest({jobId:child.jobId,recordingId:child.recordingId,userId:owner},`bytes 0-${child.data.length-1}/${child.data.length}`,child.data);
      await ingest.verify({jobId:child.jobId,recordingId:child.recordingId,userId:owner});
      const reserved=await service.reserve(child.jobId,owner);await service.beginSession(child.jobId,owner);
      assert.notEqual(reserved.driveFileId,(await sql`select drive_file_id from company_recording_transfer_intents where job_id=${first.jobId}`)[0].drive_file_id);
      assert.deepEqual(metadata[1].parents,['approvedFolder123']);
      assert.ok(privacyCalls>=2);
      const [job]=await sql`select state,confirmed_offset from company_recording_upload_jobs where id=${child.jobId}`;
      assert.equal(job.state,'pending');assert.equal(Number(job.confirmed_offset),0);
      assert.equal((await sql`select count(*)::int as n from meeting_history_items`)[0].n,0);
    });
    await t.test('uncertain session initiation persists intent and prevents duplicate creation',async()=>{
      await sql`update meetings set recording_folder_id=null where id=${meeting}`;
      const uncertain=await fixture();
      await ingest.ingest({jobId:uncertain.jobId,recordingId:uncertain.recordingId,userId:owner},`bytes 0-${uncertain.data.length-1}/${uncertain.data.length}`,uncertain.data);
      await ingest.verify({jobId:uncertain.jobId,recordingId:uncertain.recordingId,userId:owner});
      await service.reserve(uncertain.jobId,owner);
      await sql`alter table company_recording_transfer_intents add constraint test_fail_session_persist check(encrypted_session is null) not valid`;
      try {await assert.rejects(service.beginSession(uncertain.jobId,owner));}
      finally {await sql`alter table company_recording_transfer_intents drop constraint test_fail_session_persist`;}
      const [intent]=await sql`select session_creation_attempted,encrypted_session from company_recording_transfer_intents where job_id=${uncertain.jobId}`;
      assert.equal(intent.session_creation_attempted,true);assert.equal(intent.encrypted_session,null);
      const before=createCalls;await assert.rejects(second.beginSession(uncertain.jobId,owner));assert.equal(createCalls,before);
    });
    await t.test('job deletion retains historical encrypted intent without ordinary recovery',async()=>{
      const [before]=await sql`select count(*)::int as n from company_recording_transfer_intents`;
      await sql`delete from users where id=${owner}`;
      assert.equal((await sql`select count(*)::int as n from company_recording_transfer_intents`)[0].n,before.n);
      await assert.rejects(service.recoverSession(first.jobId,owner));
    });
    console.log('PASS verified-only, privacy gate, root/child, encrypted restart, concurrent intent, uncertain creation and retained orphan intent');
  } finally {await closeApp();await sql.end();await other.end();}
});
