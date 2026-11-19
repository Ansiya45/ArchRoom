import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { featureSchemaFingerprint } from '../../src/db/feature-convergence.js';
import { disposableSchemaSecurityFingerprint } from '../../src/db/disposable-schema-audit.js';

const address = process.env.DISPOSABLE_DATABASE_URL ?? '', target = new URL(address);
if (process.env.NODE_ENV !== 'test' || target.protocol !== 'postgres:' || target.hostname !== '127.0.0.1' || target.port !== '55470' ||
  target.username !== 'ylaam_disposable_admin' || target.password || target.search || !/^\/ylaam_senior_disposable_[a-f0-9]{8}$/.test(target.pathname)) throw new Error('Unsafe test target');
const sql = postgres(address, { max: 1, connect_timeout: 3 });
try {
  const [identity] = await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
  assert.deepEqual(identity, { name:target.pathname.slice(1), role:'ylaam_disposable_admin', host:'127.0.0.1/32', port:55470,
    directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg' });
  const [initial] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
  assert.equal(initial.n,0);
  await migrateDatabase(address,await historicalFixture('senior'));
  console.log('senior fingerprint:',await featureSchemaFingerprint(sql));
  console.log('senior security fingerprint:',await disposableSchemaSecurityFingerprint(sql));
  await sql.begin(async tx => { await tx.unsafe(await readFile('drizzle/convergence/senior-to-combined-v1.sql','utf8')); });
  console.log('senior combined strict:',await featureSchemaFingerprint(sql));
  console.log('senior combined logical:',await featureSchemaFingerprint(sql,true));
  console.log('senior combined security:',await disposableSchemaSecurityFingerprint(sql));
} finally { await sql.end({ timeout:3 }); }
