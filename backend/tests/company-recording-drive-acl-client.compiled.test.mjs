import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanyRecordingDriveAclClient } from '../dist/services/company-recording-drive-acl-client.js';

test('rejects changed company credentials before sending a permission request', async () => {
  let requests = 0;
  const client = new CompanyRecordingDriveAclClient(async () => ({ accountEmail: 'company@example.test', credentialGeneration: 'new', accessToken: 'mock' }), async () => { requests++; throw new Error('unexpected request'); });
  await assert.rejects(client.grantReader({ fileId: 'file', email: 'host@example.test', companyAccountEmail: 'company@example.test', credentialGeneration: 'old' }), /connection changed/);
  assert.equal(requests, 0);
});

test('rejects missing permission pages', async () => {
  const client = new CompanyRecordingDriveAclClient(async () => ({ accountEmail: 'company@example.test', credentialGeneration: 'generation', accessToken: 'mock' }), async () => new Response('{}', { status: 200 }));
  await assert.rejects(client.listPermissions('file'), /metadata is incomplete/);
});
