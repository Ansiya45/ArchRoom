import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';

const address=process.env.DISPOSABLE_DATABASE_URL ?? '',target=new URL(address);
const existing=process.env.PHASE_B_EXISTING==='1';
test('default runner and readiness use guarded disposable coordinator',{timeout:90000},async()=>{
  if(process.env.NODE_ENV!=='test'||process.env.PHASE_B_DISPOSABLE_COORDINATOR!=='1'||process.env.DATABASE_URL!==address||
    target.protocol!=='postgres:'||target.hostname!=='127.0.0.1'||target.port!=='55470'||target.username!=='ylaam_disposable_admin'||target.password||target.search||
    !/^\/ylaam_(?:fresh|converge|senior)_disposable_[a-f0-9]{8}$/.test(target.pathname))throw new Error('Unsafe disposable target');
  const sql=postgres(address,{max:1,connect_timeout:3});
  const {assertDatabaseReady}=await import('../../src/db/readiness.js');
  const {client}=await import('../../src/db/index.js');
  try {
    const [identity]=await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
    assert.deepEqual(identity,{name:target.pathname.slice(1),role:'ylaam_disposable_admin',host:'127.0.0.1/32',port:55470,directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg'});
    if(!existing){
      const [initial]=await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
      assert.equal(initial.n,0);
      await assert.rejects(assertDatabaseReady(),/not ready/);
      const [stillEmpty]=await sql`select to_regclass('drizzle.__drizzle_migrations') as ledger`;
      assert.equal(stillEmpty.ledger,null);
    }
    await migrateDatabase(address);
    await assertDatabaseReady();
    await migrateDatabase(address);
    await assertDatabaseReady();
    const markerTable=target.pathname.includes('senior_disposable')?'drizzle.senior_convergence_runs':'drizzle.feature_convergence_runs';
    const [marker]=await sql.unsafe(`select id,migration_hash from ${markerTable}`);
    await sql.unsafe(`update ${markerTable} set migration_hash='invalid'`);
    await assert.rejects(assertDatabaseReady(),/not ready/);
    await sql.unsafe(`update ${markerTable} set migration_hash=$1 where id=$2`,[marker.migration_hash,marker.id]);
    await assertDatabaseReady();
    const original=process.env.NODE_ENV;
    try {process.env.NODE_ENV='production';await assert.rejects(migrateDatabase(address),/disabled/);await assert.rejects(assertDatabaseReady(),/disabled/);}
    finally{process.env.NODE_ENV=original;}
  } finally {await client.end({timeout:3});await sql.end({timeout:3});}
});
