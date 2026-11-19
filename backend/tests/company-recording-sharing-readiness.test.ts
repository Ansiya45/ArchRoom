import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from 'postgres';
import { CompanyRecordingHistoryPublicationService } from '../src/services/company-recording-history-publication.service.js';
import { CompanyRecordingDriveFileInspector } from '../src/services/company-recording-drive-file-inspector.js';
import { companyRecordingSharingReadiness } from '../src/services/company-recording-sharing-readiness.js';

const config = { nodeEnv: 'test', jobsEnabled: true, localEnabled: true,
  databaseUrl: 'postgres://test@127.0.0.1:55459/ylaam_staging_disposable_binding_6c' };
const job = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('disabled runtime configuration keeps History publication closed', async () => {
  assert.equal(companyRecordingSharingReadiness().ready, false);
  let authorized = false;
  const noDb = (() => { throw new Error('database must not be reached'); }) as unknown as Sql;
  const service = new CompanyRecordingHistoryPublicationService(noDb, config, async () => { authorized = true; },
    async () => { throw new Error('privacy service must not be reached'); },
    async () => { throw new Error('provider must not be reached'); },
    new CompanyRecordingDriveFileInspector(async () => { throw new Error('provider must not be reached'); }));
  await assert.rejects(service.publish(job, user), /publication is unavailable/);
  assert.equal(authorized, true);
});

test('readiness opens only for an explicitly enabled local disposable configuration', () => {
  const enabled = companyRecordingSharingReadiness({
    nodeEnv: 'development', jobsEnabled: true, localEnabled: true,
    databaseUrl: 'postgres://test@127.0.0.1:5432/ylaam_staging_disposable_ngrok',
    clientId: 'client', clientSecret: 'secret',
    callbackUrl: 'https://example.ngrok-free.app/google-drive/oauth/callback',
    administratorId: '11111111-1111-4111-8111-111111111111',
    tokenKey: Buffer.alloc(32, 7).toString('base64'),
  });
  assert.equal(enabled.ready, true);
  assert.equal(companyRecordingSharingReadiness({
    nodeEnv: 'production', jobsEnabled: true, localEnabled: true,
    databaseUrl: 'postgres://test@127.0.0.1:5432/ylaam_staging_disposable_ngrok',
    clientId: 'client', clientSecret: 'secret',
    callbackUrl: 'https://example.ngrok-free.app/google-drive/oauth/callback',
    administratorId: '11111111-1111-4111-8111-111111111111',
    tokenKey: Buffer.alloc(32, 7).toString('base64'),
  }).ready, false);
});

test('publication still checks authentication before sharing readiness', async () => {
  const noDb = (() => { throw new Error('database must not be reached'); }) as unknown as Sql;
  const service = new CompanyRecordingHistoryPublicationService(noDb, config,
    async () => { throw new Error('not authorized'); }, async () => { throw new Error('unexpected'); },
    async () => { throw new Error('unexpected'); }, new CompanyRecordingDriveFileInspector(async () => { throw new Error('unexpected'); }));
  await assert.rejects(service.publish(job, user), /not authorized/);
});
