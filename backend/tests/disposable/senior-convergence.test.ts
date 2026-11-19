import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { convergeSeniorForDisposableTest } from '../../src/db/senior-convergence.js';
import { featureSchemaFingerprint } from '../../src/db/feature-convergence.js';
import { CompanyRecordingConfirmationService } from '../../src/services/company-recording-confirmation.service.js';

const address=process.env.DISPOSABLE_DATABASE_URL ?? '';
test('senior-only database converges transactionally in an isolated cluster',{timeout:90000},async t=>{
  const target=new URL(address);
  if(process.env.NODE_ENV!=='test'||target.protocol!=='postgres:'||target.hostname!=='127.0.0.1'||target.port!=='55470'||target.username!=='ylaam_disposable_admin'||
    target.password||target.search||!/^\/ylaam_senior_disposable_[a-f0-9]{8}$/.test(target.pathname)) throw new Error('Unsafe disposable test target');
  const sql=postgres(address,{max:1,connect_timeout:3});
  const run=(hook?:()=>Promise<void>)=>convergeSeniorForDisposableTest(address,'src/db/senior-ledger-identities.json','drizzle/convergence/senior-to-combined-v1.sql',hook);
  try {
    const [identity]=await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
    assert.deepEqual(identity,{name:target.pathname.slice(1),role:'ylaam_disposable_admin',host:'127.0.0.1/32',port:55470,directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg'});
    const [initial]=await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
    assert.equal(initial.n,0,'Refusing a nonempty database');
    await migrateDatabase(address,await historicalFixture('senior'));
    const before=await featureSchemaFingerprint(sql);
    const owner=randomUUID(),meeting=randomUUID(), invitation=randomUUID();
    await sql`insert into users(id,email,password_hash,full_name,role) values (${owner},'senior-owner@example.invalid','test','Senior Host','admin')`;
    await sql`insert into user_permissions(user_id,feature,level) values (${owner},'recording','write')`;
    await sql`insert into user_invitations(id,email,role,token_hash,invited_by,expires_at) values (${invitation},'invite@example.invalid','user',${'b'.repeat(64)},${owner},now()+interval '1 day')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id,transcript_access) values (${meeting},'YLM-SE1234','Senior meeting',${owner},'host')`;
    await sql`insert into meeting_history_items(meeting_id,kind,dedupe_key,content) values (${meeting},'transcript','transcript-test','Transcript'),(${meeting},'summary','summary-test','Recap')`;
    await t.test('rejects unknown ledger and schema drift',async()=>{
      await assert.rejects(convergeSeniorForDisposableTest(address,'drizzle/convergence/senior-to-combined-v1.sql','drizzle/convergence/senior-to-combined-v1.sql'),/inputs/);
      await sql`insert into drizzle.__drizzle_migrations(hash,created_at) values (${'f'.repeat(64)},1999999999999)`;
      await assert.rejects(run(),/ledger/);
      await sql`delete from drizzle.__drizzle_migrations where created_at=1999999999999`;
      await sql`alter table meetings alter column title set default 'unexpected drift'`;
      await assert.rejects(run(),/baseline/);
      await sql`alter table meetings alter column title drop default`;
      assert.equal(await featureSchemaFingerprint(sql),before);
    });
    await t.test('rejects orphaned historical data',async()=>{
      const orphan=randomUUID();
      try{await sql`set session_replication_role='replica'`;await sql`insert into meetings(id,meeting_code,title,host_user_id) values (${orphan},'YLM-ORPHAN','Bad',${randomUUID()})`;}
      finally{await sql`set session_replication_role='origin'`;}
      await assert.rejects(run(),/foreign key/);
      await sql`delete from meetings where id=${orphan}`;
    });
    await t.test('interrupted transaction rolls back and retries safely',async()=>{
      await assert.rejects(run(async()=>{throw new Error('simulated interruption');}),/simulated interruption/);
      assert.equal(await featureSchemaFingerprint(sql),before);
      const [row]=await sql`select to_regclass('drizzle.senior_convergence_runs') as marker`;
      assert.equal(row.marker,null);
    });
    await t.test('preserves senior data and matches feature-to-combined logical catalog',async()=>{
      assert.equal(await run(),'converged');assert.equal(await run(),'already-converged');
      const [row]=await sql`select u.role::text as role,m.title,m.transcript_access,
        (select level::text from user_permissions where user_id=${owner} and feature='recording') as permission,
        (select count(*)::int from user_invitations where id=${invitation}) as invitations,
        (select count(*)::int from meeting_history_items where meeting_id=${meeting} and kind in ('transcript','summary')) as history,
        (select count(*)::int from drizzle.__drizzle_migrations) as ledger_count,
        to_regclass('public.batch_student_enrollments')::text as enrollments,
        to_regclass('public.company_recording_upload_jobs')::text as jobs,
        to_regclass('public.meeting_recording_consent_requests')::text as consent
        from users u join meetings m on m.host_user_id=u.id where u.id=${owner} and m.id=${meeting}`;
      assert.deepEqual(row,{role:'admin',title:'Senior meeting',transcript_access:'host',permission:'write',invitations:1,history:2,ledger_count:15,
        enrollments:'batch_student_enrollments',jobs:'company_recording_upload_jobs',consent:'meeting_recording_consent_requests'});
      const consent=await sql`select relname,relrowsecurity from pg_class where oid in ('public.meeting_recording_consent_requests'::regclass,'public.meeting_recording_consent_responses'::regclass) order by relname`;
      assert.deepEqual(consent.map(item=>[item.relname,item.relrowsecurity]),[['meeting_recording_consent_requests',true],['meeting_recording_consent_responses',true]]);
      const reference=postgres('postgres://ylaam_disposable_admin@127.0.0.1:55470/ylaam_converge_disposable_e8140a06',{max:1,connect_timeout:3});
      try{
        const [ref]=await reference`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
        assert.deepEqual(ref,{name:'ylaam_converge_disposable_e8140a06',role:'ylaam_disposable_admin',host:'127.0.0.1/32',port:55470,directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg'});
        assert.equal(await featureSchemaFingerprint(sql,true),await featureSchemaFingerprint(reference,true));
      }finally{await reference.end({timeout:3});}
      await sql`alter table users alter column full_name set default 'drift'`;
      await assert.rejects(run(),/does not match/);
      await sql`alter table users alter column full_name drop default`;
      assert.equal(await run(),'already-converged');
    });
    await t.test('verified recording confirmation reads new tables',async()=>{
      const recording=randomUUID(),job=randomUUID(),generation=randomUUID(),file='fileTest123456789',folder='folderTest1234567',hash='a'.repeat(64),url=`https://drive.google.com/file/d/${file}/view`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,destination_folder_id,access_policy,mime_type,byte_length,sha256,drive_file_id,verified_drive_file_id,state,confirmed_offset,completed_at)
        values (${job},${recording},${owner},${meeting},${folder},'private','video/webm',123,${hash},${file},${file},'completed',123,now())`;
      await sql`insert into company_recording_transfer_intents(job_id,recording_id,owner_user_id,drive_file_id,company_account_email,credential_generation,destination_folder_id,drive_confirmed_offset)
        values (${job},${recording},${owner},${file},'company@example.invalid',${generation},${folder},123)`;
      await sql`insert into company_recording_drive_verifications(job_id,recording_id,drive_file_id,destination_folder_id,expected_byte_length,observed_byte_length,expected_mime_type,observed_mime_type,expected_sha256,observed_sha256,company_account_email,credential_generation,outcome)
        values (${job},${recording},${file},${folder},123,123,'video/webm','video/webm',${hash},${hash},'company@example.invalid',${generation},'verified')`;
      await sql`insert into meeting_history_items(meeting_id,kind,dedupe_key,content) values (${meeting},'drive',${`company-drive:${recording}`},${url})`;
      const service=new CompanyRecordingConfirmationService(sql,async(id,user)=>{assert.equal(id,job);assert.equal(user,owner);return {recordingId:recording,meetingId:meeting,occurrenceId:null};});
      assert.equal((await service.confirm(recording,owner))?.historyUrl,url);
    });
  }finally{await sql.end({timeout:3});}
});
