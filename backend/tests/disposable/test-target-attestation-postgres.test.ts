import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import { attestTestTarget } from '../../src/db/test-target-attestation.js';

// Read-only test of the previously independently verified second cluster.
// It does not authorize migration execution or create application objects.
test('read-only attestation checks the actual independent PostgreSQL identity', async () => {
  const sql = postgres('postgres://ylaam_disposable_admin@127.0.0.1:55471/ylaam_fresh_disposable_b211ca01', { max: 1, connect_timeout: 3 });
  const approval = { systemIdentifier: '7709099173809031496', databaseOid: '16384', database: 'ylaam_fresh_disposable_b211ca01', role: 'ylaam_disposable_admin', address: '127.0.0.1/32', port: 55471, dataDirectory: 'D:/Development/ArchRoom/backend/.phase-b-independent-pg-20261117' };
  try {
    await attestTestTarget(sql, approval);
    await assert.rejects(attestTestTarget(sql, { ...approval, databaseOid: '0' }));
    await assert.rejects(attestTestTarget(sql, { ...approval, systemIdentifier: '0' }));
    const [objects] = await sql`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','p','v','m','S')`;
    assert.equal(objects.n, 0);
  } finally { await sql.end({ timeout: 3 }); }
});
