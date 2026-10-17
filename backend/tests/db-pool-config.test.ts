import assert from 'node:assert/strict';
import { test } from 'node:test';

// Never load the developer's database configuration or connect to a database.
process.env.DOTENV_CONFIG_PATH = 'tests/.unused-db-pool-env';
process.env.DATABASE_URL = 'postgres://localhost/unused';
process.env.JWT_SECRET = 'isolated-pool-test';
delete process.env.DB_POOL_MAX;

const { envSchema } = await import('../src/env.js');
const { client } = await import('../src/db/index.js');
const base = { DATABASE_URL: 'postgres://localhost/unused', JWT_SECRET: 'test-secret' };

test('shared database client defaults to three connections', async () => {
  assert.equal(envSchema.parse(base).DB_POOL_MAX, 3);
  assert.equal(client.options.max, 3);
  await client.end();
});

test('accepts each supported per-process pool size', () => {
  for (const size of [1, 2, 3, 4, 5]) {
    assert.equal(envSchema.parse({ ...base, DB_POOL_MAX: String(size) }).DB_POOL_MAX, size);
  }
});

test('rejects invalid and excessive pool sizes', () => {
  for (const value of ['', '0', '-1', '6', '200', '1.5', '1e1', 'abc', ' 3 ', '03']) {
    assert.equal(envSchema.safeParse({ ...base, DB_POOL_MAX: value }).success, false, value);
  }
});
