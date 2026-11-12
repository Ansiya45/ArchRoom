import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireLocalStaging } from '../src/services/local-recording-ingestion.service.js';

test('local staging gates fail closed and cannot activate production or remote databases', () => {
  const valid = { nodeEnv: 'test', jobsEnabled: true, localEnabled: true, databaseUrl: 'postgres://test@127.0.0.1:55449/ylaam_staging_disposable_0019' };
  assert.doesNotThrow(() => requireLocalStaging(valid));
  for (const change of [
    { nodeEnv: 'production' }, { nodeEnv: 'unknown' }, { jobsEnabled: false }, { localEnabled: false },
    { localEnabled: undefined }, { jobsEnabled: 'true' }, { databaseUrl: 'postgres://test@remote.example/ylaam_staging_disposable_0019' },
    { databaseUrl: 'postgres://test@127.0.0.1/development' }, { databaseUrl: 'not a URL' },
    { databaseUrl: 'postgres://test@127.0.0.1/ylaam_staging_disposable_0019?host=remote' },
  ]) assert.throws(() => requireLocalStaging({ ...valid, ...change } as typeof valid), /LOCAL_STAGING_DISABLED/);
});
