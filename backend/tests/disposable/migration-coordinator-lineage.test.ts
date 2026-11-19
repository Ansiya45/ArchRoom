import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { coordinateDisposableMigration } from '../../src/db/disposable-migration-coordinator.js';
import { featureSchemaFingerprint } from '../../src/db/feature-convergence.js';

const address=process.env.DISPOSABLE_DATABASE_URL ?? '', lineage=process.env.TEST_CONVERGENCE_LINEAGE;
test('coordinator upgrades a historical lineage in the isolated cluster',{timeout:90000},async t=>{
  const target=new URL(address);
  const pattern=lineage==='feature'?/^\/ylaam_converge_disposable_[a-f0-9]{8}$/:lineage==='senior'?/^\/ylaam_senior_disposable_[a-f0-9]{8}$/:null;
  if(process.env.NODE_ENV!=='test'||!pattern||target.protocol!=='postgres:'||target.hostname!=='127.0.0.1'||target.port!=='55470'||
    target.username!=='ylaam_disposable_admin'||target.password||target.search||!pattern.test(target.pathname))throw new Error('Unsafe disposable target');
  const sql=postgres(address,{max:1,connect_timeout:3}),run=(hook?:()=>Promise<void>)=>coordinateDisposableMigration(address,process.cwd(),hook);
  try {
    const [identity]=await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
    assert.deepEqual(identity,{name:target.pathname.slice(1),role:'ylaam_disposable_admin',host:'127.0.0.1/32',port:55470,directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg'});
    const [initial]=await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
    assert.equal(initial.n,0);
    await migrateDatabase(address,lineage==='feature'?await historicalFixture('feature'):await historicalFixture('senior'));
    const before=await featureSchemaFingerprint(sql),owner=randomUUID(),meeting=randomUUID();
    await sql`insert into users(id,email,password_hash,full_name) values (${owner},'coordinator@example.invalid','test','Retained host')`;
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values (${meeting},'YLM-COORD1','Retained meeting',${owner})`;
    await t.test('rejects drift and rolls back interrupted DDL',async()=>{
      await sql`alter table meetings alter column title set default 'drift'`;
      await assert.rejects(run(),/baseline/);
      await sql`alter table meetings alter column title drop default`;
      await sql`alter table meetings disable trigger all`;
      await assert.rejects(run(),/baseline/);
      await sql`alter table meetings enable trigger all`;
      await assert.rejects(run(async()=>{throw new Error('simulated interruption');}),/simulated interruption/);
      assert.equal(await featureSchemaFingerprint(sql),before);
    });
    await t.test('upgrades and revalidates without changing the historical ledger',async()=>{
      assert.equal(await run(),'converged'); assert.equal(await run(),'already-converged');
      const [state]=await sql`select m.title,u.full_name,(select count(*)::int from drizzle.__drizzle_migrations) as ledger_count,
        to_regclass('public.meeting_recording_consent_requests')::text as requests,to_regclass('public.meeting_recording_consent_responses')::text as responses
        from meetings m join users u on u.id=m.host_user_id where m.id=${meeting}`;
      assert.deepEqual(state,{title:'Retained meeting',full_name:'Retained host',ledger_count:lineage==='feature'?32:15,
        requests:'meeting_recording_consent_requests',responses:'meeting_recording_consent_responses'});
      assert.equal(await featureSchemaFingerprint(sql,true),'b44aac02abd71f7de57715ac37aa952ccbc501ffc9e902a26f3542d6bbc987f6');
    });
    await t.test('rejects a missing or mismatched convergence record',async()=>{
      const table=lineage==='feature'?'drizzle.feature_convergence_runs':'drizzle.senior_convergence_runs';
      const [marker]=await sql.unsafe(`select id,migration_hash,applied_at from ${table}`);
      await sql.unsafe(`delete from ${table}`);
      await assert.rejects(run(),/execution record/);
      await sql.unsafe(`insert into ${table}(id,migration_hash,applied_at) values ($1,$2,$3)`,[marker.id,'bad',marker.applied_at]);
      await assert.rejects(run(),/execution record/);
      await sql.unsafe(`update ${table} set migration_hash=$1`,[marker.migration_hash]);
      assert.equal(await run(),'already-converged');
    });
  }finally{await sql.end({timeout:3});}
});
