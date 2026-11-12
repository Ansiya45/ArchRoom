import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55456/ylaam_enrollment_disposable_6b1';
test('batch enrollment authorization, lifecycle and transactional audit', { timeout: 120000 }, async () => {
  if (process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Unsafe test environment');
  console.log('Disposable PostgreSQL target: host=127.0.0.1 port=55456 database=ylaam_enrollment_disposable_6b1');
  const sql = postgres(url, { max: 3 });
  try {
    const [identity] = await sql`select current_database() as name, current_setting('data_directory') as directory, inet_server_addr()::text as host, inet_server_port() as port`;
    assert.equal(identity.name, 'ylaam_enrollment_disposable_6b1'); assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55456);
    assert.equal(identity.directory.replaceAll('\\', '/').toLowerCase(), 'd:/development/archroom/.codex-pg-enrollment-6b1');
    const [empty] = await sql`select to_regclass('public.users') as users`; assert.equal(empty.users, null);
    const { migrateDatabase } = await import('../../src/db/migrate.js'); await migrateDatabase(url); await migrateDatabase(url);
    const { client } = await import('../../src/db/index.js');
    const { BatchStudentEnrollmentService } = await import('../../src/services/batch-student-enrollment.service.js');
    const { recordingFoldersRouter } = await import('../../src/routers/recording-folders.js');
    const admin=randomUUID(), manager=randomUUID(), other=randomUUID(), trainer=randomUUID();
    try {
      await sql`insert into users(id,email,password_hash,full_name) values (${admin},'admin@example.invalid','test','Admin'),(${manager},'manager@example.invalid','test','Manager'),(${other},'other@example.invalid','test','Other'),(${trainer},'trainer@example.invalid','test','Trainer')`;
      await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values ('batchFolder001','Batch A',${admin}),('batchFolder002','Batch B',${admin})`;
      await sql`insert into recording_batch_folder_permissions(folder_id,user_id,role) values ('batchFolder001',${manager},'manager'),('batchFolder001',${trainer},'trainer'),('batchFolder002',${other},'manager')`;
      const service=new BatchStudentEnrollmentService(admin);
      const context=(id: string | null)=>({ req:{} as any,res:{} as any,jwtSecret:'test',isAuthenticated:Boolean(id),user:id?{id,email:'test@example.invalid'}:null });
      await assert.rejects(recordingFoldersRouter.createCaller(context(null)).listStudents({folderId:'batchFolder001'}), {code:'UNAUTHORIZED'});
      await assert.rejects(service.list('batchFolder001',other),{code:'FORBIDDEN'});
      await assert.rejects(service.add('batchFolder001','Student','student@example.invalid',trainer),{code:'FORBIDDEN'});
      const [a,b]=await Promise.all([service.add('batchFolder001','Student',' Student@Example.invalid ',manager),service.add('batchFolder001','Student','student@example.invalid',manager)]);
      assert.equal(a.id,b.id); assert.equal(a.status,'pending');
      const different=await service.add('batchFolder002','Student','student@example.invalid',other); assert.notEqual(a.id,different.id);
      await assert.rejects(service.transition('batchFolder002',a.id,'approve',other),{code:'NOT_FOUND'});
      const self=await service.add('batchFolder001','Manager','manager@example.invalid',admin);
      await assert.rejects(service.transition('batchFolder001',self.id,'approve',manager),{code:'FORBIDDEN'});
      assert.equal((await service.transition('batchFolder001',a.id,'approve',manager)).approvedBy,manager);
      await service.transition('batchFolder001',a.id,'approve',manager);
      const removed=await service.transition('batchFolder001',a.id,'remove',admin); assert.equal(removed.status,'removed');assert.equal(removed.removedBy,admin);
      assert.equal((await service.add('batchFolder001','Student','student@example.invalid',manager)).status,'removed');
      const reapproved=await service.transition('batchFolder001',a.id,'approve',manager);assert.equal(reapproved.status,'approved');assert.equal(reapproved.removedAt,null);
      const result=await service.list('batchFolder001',manager);
      assert.deepEqual(result.events.filter(e=>e.enrollmentId===a.id).map(e=>e.action),['added','approved','removed','reapproved']);
      await assert.rejects(sql`insert into batch_student_enrollments(folder_id,student_name,student_email,status) values ('batchFolder001','Bad','bad@example.invalid','invalid')`);
      const [count]=await sql`select count(*)::int as n from batch_student_enrollments where folder_id='batchFolder001' and student_email='student@example.invalid'`;assert.equal(count.n,1);
    } finally { await client.end({ timeout: 5 }); }
  } finally { await sql.end({ timeout: 5 }); }
});
