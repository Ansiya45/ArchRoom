import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55457/ylaam_registration_disposable_6b34';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
test('batch registration on an isolated disposable PostgreSQL database', { timeout: 120000 }, async t => {
  if (process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Unsafe test environment');
  console.log('Disposable PostgreSQL target: host=127.0.0.1 port=55457 database=ylaam_registration_disposable_6b34');
  const sql = postgres(url, { max: 3 });
  try {
    const [identity] = await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    assert.equal(identity.name,'ylaam_registration_disposable_6b34');assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55457);
    assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(),'d:/development/archroom/.codex-pg-registration-6b34');
    const [empty] = await sql`select to_regclass('public.users') as users`;assert.equal(empty.users,null);
    const { migrateDatabase } = await import('../../src/db/migrate.js');await migrateDatabase(url);await migrateDatabase(url);
    const { client } = await import('../../src/db/index.js');
    const { BatchRegistrationService } = await import('../../src/services/batch-registration.service.js');
    const { BatchStudentEnrollmentService } = await import('../../src/services/batch-student-enrollment.service.js');
    const { batchRegistrationRouter } = await import('../../src/routers/batch-registration.js');
    const manager=randomUUID(), other=randomUUID(), admin=randomUUID();
    const messages: { to: string; html: string }[]=[];
    let deliveryFailure=false;
    const service=new BatchRegistrationService(admin,'http://localhost:5174','synthetic-rate-key',async input=>{ if(deliveryFailure)throw new Error('mock provider failure');messages.push(input); });
    const enrollment=new BatchStudentEnrollmentService(admin);
    const tokenOf=(link:string)=>new URL(link).hash.slice(1);
    const emailToken=(email:string)=>tokenOf(messages.filter(m=>m.to===email).at(-1)!.html.match(/href="([^"]+)"/)![1]);
    const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('External network forbidden');};
    try {
      await sql`insert into users(id,email,password_hash,full_name) values (${manager},'manager@example.invalid','test','Manager'),(${other},'other@example.invalid','test','Other'),(${admin},'admin@example.invalid','test','Admin')`;
      await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values ('registrationBatchA','Batch A',${admin}),('registrationBatchB','Batch B',${admin})`;
      await sql`insert into recording_batch_folder_permissions(folder_id,user_id,role) values ('registrationBatchA',${manager},'manager'),('registrationBatchB',${other},'manager')`;
      let link='';
      await t.test('manager-only generation, safe identity, hash-only storage and expiry', async()=>{
        await assert.rejects(service.generate('registrationBatchA',other,7),{code:'FORBIDDEN'});
        link=tokenOf((await service.generate('registrationBatchA',manager,7)).registrationUrl);
        assert.equal(link.length,43);assert.deepEqual(await service.identify(link,'info'),{batchName:'Batch A'});
        const [stored]=await sql`select * from batch_registration_links where folder_id='registrationBatchA'`;assert.equal(stored.token_hash,hash(link));assert.ok(!JSON.stringify(stored).includes(link));
        await assert.rejects(service.generate('registrationBatchA',manager,31));
        await sql`update batch_registration_links set expires_at=now()-interval '1 second' where folder_id='registrationBatchA'`;
        await assert.rejects(service.identify(link,'info'));
        link=tokenOf((await service.generate('registrationBatchA',admin,7)).registrationUrl);
      });
      await t.test('registration, verification and approval remain separate; verification is single-use',async()=>{
        await service.register(link,'Student','Student@example.invalid','register1');
        let student=(await enrollment.list('registrationBatchA',manager)).students[0];
        assert.equal(student.status,'pending');assert.equal(student.emailVerifiedAt,null);assert.equal(student.source,'registration');
        await assert.rejects(enrollment.transition('registrationBatchA',student.id,'approve',manager),{code:'PRECONDITION_FAILED'});
        const token=emailToken('student@example.invalid');
        const results=await Promise.allSettled([service.verify(token,'verify1'),service.verify(token,'verify2')]);
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        student=(await enrollment.list('registrationBatchA',manager)).students[0];assert.ok(student.emailVerifiedAt);assert.equal(student.status,'pending');
        assert.equal((await enrollment.transition('registrationBatchA',student.id,'approve',manager)).status,'approved');
        await assert.rejects(service.verify(token,'verify3'));
      });
      await t.test('concurrent duplicates stay within the token-bound batch',async()=>{
        await Promise.all([service.register(link,'Duplicate','duplicate@example.invalid','dup1'),service.register(link,'Duplicate',' DUPLICATE@example.invalid ','dup2')]);
        const [count]=await sql`select count(*)::int as count from batch_student_enrollments where student_email='duplicate@example.invalid'`;assert.equal(count.count,1);
        const linkB=tokenOf((await service.generate('registrationBatchB',other,7)).registrationUrl);
        await service.register(linkB,'Duplicate','duplicate@example.invalid','dup3');
        const [countB]=await sql`select count(*)::int as count from batch_student_enrollments where student_email='duplicate@example.invalid'`;assert.equal(countB.count,2);
        const ctx={req:{socket:{remoteAddress:'test'}} as any,res:{setHeader:()=>{}} as any,isAuthenticated:false,user:null,jwtSecret:'test'};
        await assert.rejects(batchRegistrationRouter.createCaller(ctx).register({token:link,name:'Test',email:'test@example.invalid',folderId:'registrationBatchB'} as any),{code:'BAD_REQUEST'});
        await assert.rejects(batchRegistrationRouter.createCaller(ctx).generateLink({folderId:'registrationBatchA',expiresInDays:7}),{code:'UNAUTHORIZED'});
      });
      await t.test('regeneration and disablement invalidate outstanding verification tokens',async()=>{
        await service.register(link,'Rotate','rotate@example.invalid','rotate');const oldToken=emailToken('rotate@example.invalid');const oldLink=link;
        link=tokenOf((await service.generate('registrationBatchA',manager,1)).registrationUrl);
        await assert.rejects(service.identify(oldLink,'info'));await assert.rejects(service.verify(oldToken,'rotateVerify'));
        await service.register(link,'Disable','disable@example.invalid','disable');const disabledToken=emailToken('disable@example.invalid');
        await service.disable('registrationBatchA',manager);await service.disable('registrationBatchA',manager);
        assert.equal((await service.linkStatus('registrationBatchA',manager)).active,false);
        await assert.rejects(service.register(link,'No','no@example.invalid','disabled'));await assert.rejects(service.verify(disabledToken,'disabledVerify'));
        link=tokenOf((await service.generate('registrationBatchA',manager,7)).registrationUrl);
      });
      await t.test('expired and invalid verification tokens fail without approval',async()=>{
        await service.register(link,'Expired','expired@example.invalid','expired');const token=emailToken('expired@example.invalid');
        await sql`update batch_registration_verifications set expires_at=now()-interval '1 second' where token_hash=${hash(token)}`;
        await assert.rejects(service.verify(token,'expiredVerify'));await assert.rejects(service.verify('x'.repeat(43),'invalidVerify'));
      });
      await t.test('manual additions and removed enrollment are never overwritten or self-restored',async()=>{
        const manual=await enrollment.add('registrationBatchA','Original manual name','manual@example.invalid',manager);
        await enrollment.transition('registrationBatchA',manual.id,'approve',manager);
        await service.register(link,'Changed name','manual@example.invalid','manual');await service.verify(emailToken('manual@example.invalid'),'manualVerify');
        let row=(await enrollment.list('registrationBatchA',manager)).students.find(s=>s.id===manual.id)!;
        assert.equal(row.studentName,'Original manual name');assert.equal(row.status,'approved');assert.equal(row.source,'manual');
        await enrollment.transition('registrationBatchA',manual.id,'remove',manager);
        await service.register(link,'Restore attempt','manual@example.invalid','manual2');await service.verify(emailToken('manual@example.invalid'),'manualVerify2');
        row=(await enrollment.list('registrationBatchA',manager)).students.find(s=>s.id===manual.id)!;assert.equal(row.status,'removed');
      });
      await t.test('delivery failures and existing addresses have the same generic response',async()=>{
        const known=await service.register(link,'Student','student@example.invalid','known');deliveryFailure=true;
        const failed=await service.register(link,'New','delivery@example.invalid','failed');deliveryFailure=false;
        assert.deepEqual(failed,known);assert.ok(!JSON.stringify(failed).includes('delivery@example.invalid'));
      });
      await t.test('database rollback leaves verification token usable',async()=>{
        await service.register(link,'Rollback','rollback@example.invalid','rollback');const token=emailToken('rollback@example.invalid');
        await sql`create function test_reject_email_event() returns trigger language plpgsql as $$ begin if NEW.action='email_verified' then raise exception 'test rollback'; end if; return NEW; end $$`;
        await sql`create trigger test_email_event before insert on batch_student_enrollment_events for each row execute function test_reject_email_event()`;
        await assert.rejects(service.verify(token,'rollback1'));
        const [row]=await sql`select consumed_at from batch_registration_verifications where token_hash=${hash(token)}`;assert.equal(row.consumed_at,null);
        await sql`drop trigger test_email_event on batch_student_enrollment_events`;await sql`drop function test_reject_email_event()`;
        await service.verify(token,'rollback2');
      });
      await t.test('public request limits are atomic across instances',async()=>{
        const second=new BatchRegistrationService(admin,'http://localhost:5174','synthetic-rate-key',async()=>{});
        const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?service:second).register('x'.repeat(43),'Test','rate@example.invalid','sharedIP')));
        assert.equal(outcomes.filter(r=>r.status==='rejected'&&(r.reason as any).code==='TOO_MANY_REQUESTS').length,2);
      });
      await t.test('Google identity remains account-scoped and unverified with no attach endpoint',async()=>{
        const caller=batchRegistrationRouter.createCaller({req:{} as any,res:{} as any,isAuthenticated:true,user:{id:manager,email:'manager@example.invalid'},jwtSecret:'test'});
        assert.deepEqual(await caller.googleIdentityStatus(),{userId:manager,status:'unverified',linkingAvailable:false,usableForDrive:false});
        await assert.rejects(caller.googleIdentityStatus({userId:other} as any),{code:'BAD_REQUEST'});
        await assert.rejects(sql`insert into student_google_identities(user_id,google_subject,google_email,verified_at) values (${manager},'forged','forged@example.invalid',now())`);
        const [count]=await sql`select count(*)::int as count from users`;assert.equal(count.count,3);
      });
    } finally {globalThis.fetch=originalFetch;await client.end({timeout:5});}
  } finally {await sql.end({timeout:5});}
});
