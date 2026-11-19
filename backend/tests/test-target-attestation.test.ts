import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from 'postgres';
import { attestTestTarget } from '../src/db/test-target-attestation.js';

test('read-only test attestation requires exact cluster, database and privilege evidence', async () => {
  const previous = process.env.NODE_ENV;
  const approval = { systemIdentifier: '123', databaseOid: '456', database: 'testdb', role: 'tester', address: '127.0.0.1/32', port: 1234, dataDirectory: '/isolated' };
  const row = { system_identifier: '123', database_oid: '456', database: 'testdb', role: 'tester', address: '127.0.0.1/32', port: 1234, data_directory: '/isolated', superuser: true, can_create: true };
  const mock = (value: object) => (async () => [value]) as unknown as Sql;
  try {
    process.env.NODE_ENV = 'test';
    await attestTestTarget(mock(row), approval);
    for (const change of [{ system_identifier: 'other' }, { database_oid: 'other' }, { role: 'other' }, { address: '192.0.2.1/32' }, { data_directory: '/other' }, { superuser: false }, { can_create: false }])
      await assert.rejects(attestTestTarget(mock({ ...row, ...change }), approval));
    process.env.NODE_ENV = 'production';
    await assert.rejects(attestTestTarget(mock(row), approval));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
