import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateDatabase } from '../src/db/migrate.js';

test('custom historical migration folder cannot bypass disposable target restrictions', async () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(migrateDatabase('postgres://ylaam_disposable_admin@127.0.0.1:55470/ylaam_fresh_disposable_aa061103', 'fixture'), /restricted/);
    process.env.NODE_ENV = 'test';
    for (const url of [
      'postgres://admin@127.0.0.1:55470/production',
      'postgres://ylaam_disposable_admin@127.0.0.1:5432/ylaam_fresh_disposable_aa061103',
      'postgres://ylaam_disposable_admin@192.0.2.1:55470/ylaam_fresh_disposable_aa061103',
    ]) await assert.rejects(migrateDatabase(url, 'fixture'), /restricted/);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
