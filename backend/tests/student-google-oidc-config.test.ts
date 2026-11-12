import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from 'postgres';
import { StudentGoogleOidcService } from '../src/services/student-google-oidc.service.js';

test('student OIDC fails closed without separate client and safe callback before database or provider access', async () => {
  const sql = (() => { throw new Error('unexpected database access'); }) as unknown as Sql;
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('unexpected provider access'); }) as typeof fetch;
  const base = { clientId: 'student', clientSecret: 'secret', companyClientId: 'company', callbackUrl: 'https://example.invalid/student-google/callback' };
  const owner = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  for (const change of [{ companyClientId: undefined }, { clientId: 'company' }, { clientSecret: undefined },
    { callbackUrl: 'https://example.invalid/wrong' }, { callbackUrl: 'http://example.invalid/student-google/callback' },
    { callbackUrl: 'https://example.invalid/student-google/callback?x=1' }]) {
    const service = new StudentGoogleOidcService(sql, { ...base, ...change }, fetcher);
    await assert.rejects(service.start(owner), /unavailable/);
  }
  assert.equal(calls, 0);
});
