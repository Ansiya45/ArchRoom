import { historicalFixture } from './historical-fixture.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { featureSchemaFingerprint } from '../../src/db/feature-convergence.js';

const address = process.env.DISPOSABLE_DATABASE_URL ?? '';
const parsed = new URL(address);
if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgres:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55470' ||
  parsed.username !== 'ylaam_disposable_admin' || parsed.password || parsed.search || !/^\/ylaam_converge_disposable_[a-f0-9]{8}$/.test(parsed.pathname)) throw new Error('Unsafe test target');
const sql = postgres(address, { max: 1, connect_timeout: 3 });
try {
  const [identity] = await sql`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
  assert.deepEqual(identity, { name:parsed.pathname.slice(1), role:'ylaam_disposable_admin', host:'127.0.0.1/32', port:55470,
    directory:'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg' });
  const [initial] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p')`;
  assert.equal(initial.n, 0);
  await migrateDatabase(address, await historicalFixture('feature'));
  console.log('feature fingerprint:', await featureSchemaFingerprint(sql));
  await sql.begin(async tx => { await tx.unsafe(await readFile('drizzle/convergence/feature-to-combined-v1.sql', 'utf8')); });
  console.log('combined fingerprint:', await featureSchemaFingerprint(sql));
} finally { await sql.end({timeout:3}); }
