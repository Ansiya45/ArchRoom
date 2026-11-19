import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import { coordinateDisposableMigration } from '../../src/db/disposable-migration-coordinator.js';
import { featureSchemaFingerprint } from '../../src/db/feature-convergence.js';

const address=process.env.DISPOSABLE_DATABASE_URL ?? '';
test('fresh disposable installation is transactional, repeatable and fails closed', {timeout:90000}, async t=>{
  const target=new URL(address);
  if(process.env.NODE_ENV!=='test'||target.protocol!=='postgres:'||target.hostname!=='127.0.0.1'||target.port!=='55470'||target.username!=='ylaam_disposable_admin'||target.password||target.search||
    !/^\/ylaam_fresh_disposable_[a-f0-9]{8}$/.test(target.pathname))throw new Error('Unsafe test target');
  const sql=postgres(address,{max:1,connect_timeout:3});
  const run=(hook?:()=>Promise<void>)=>coordinateDisposableMigration(address,process.cwd(),hook);
  try {
    const [identity]=await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
    assert.deepEqual(identity,{name:target.pathname.slice(1),role:'ylaam_disposable_admin',host:'127.0.0.1/32',port:55470,directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg'});
    const [initial]=await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
    assert.equal(initial.n,0,'Refusing a nonempty database');
    await t.test('unexpected objects block fresh installation',async()=>{
      await sql`create table public.unexpected_object(id integer)`;
      await assert.rejects(run(),/unexpected schema objects/);
      await sql`drop table public.unexpected_object`;
    });
    await t.test('interruption rolls back all schema changes',async()=>{
      await assert.rejects(run(async()=>{throw new Error('simulated interruption');}),/simulated interruption/);
      const [state]=await sql`select to_regclass('public.users') as users,to_regclass('drizzle.__drizzle_migrations') as ledger`;
      assert.equal(state.users,null);assert.equal(state.ledger,null);
    });
    await t.test('fresh install and repeated execution preserve authentic history',async()=>{
      assert.equal(await run(),'fresh-converged');assert.equal(await run(),'already-converged');
      const [state]=await sql`select (select count(*)::int from drizzle.__drizzle_migrations) as count,
        to_regclass('public.meeting_recording_consent_requests')::text as requests,
        to_regclass('public.meeting_recording_consent_responses')::text as responses`;
      assert.deepEqual(state,{count:32,requests:'meeting_recording_consent_requests',responses:'meeting_recording_consent_responses'});
      assert.equal(await featureSchemaFingerprint(sql,true),'b44aac02abd71f7de57715ac37aa952ccbc501ffc9e902a26f3542d6bbc987f6');
    });
    await t.test('rejects missing or altered marker, unknown ledger and schema drift',async()=>{
      const [marker]=await sql`select * from drizzle.feature_convergence_runs`;
      await sql`delete from drizzle.feature_convergence_runs`;
      await assert.rejects(run(),/execution record/);
      await sql`insert into drizzle.feature_convergence_runs(id,migration_hash,applied_at) values (${marker.id},'bad',${marker.applied_at})`;
      await assert.rejects(run(),/execution record/);
      await sql`update drizzle.feature_convergence_runs set migration_hash=${marker.migration_hash}`;
      await sql`insert into drizzle.__drizzle_migrations(hash,created_at) values (${'f'.repeat(64)},1999999999999)`;
      await assert.rejects(run(),/unknown|ambiguous/);
      await sql`delete from drizzle.__drizzle_migrations where created_at=1999999999999`;
      await sql`alter table users alter column full_name set default 'drift'`;
      await assert.rejects(run(),/does not match/);
      await sql`alter table users alter column full_name drop default`;
      await sql`alter table meetings disable trigger all`;
      await assert.rejects(run(),/does not match/);
      await sql`alter table meetings enable trigger all`;
      assert.equal(await run(),'already-converged');
    });
  } finally {await sql.end({timeout:3});}
});
