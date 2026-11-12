import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envSchema } from '../src/env.js';
import { CompanyRecordingJobsService } from '../src/services/company-recording-jobs.service.js';

const input = { recordingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', meetingCode: 'YLM-ABC234', mimeType: 'video/webm' as const, byteLength: 30, sha256: 'a'.repeat(64) };
test('company upload jobs are off by default and reject operations before external work', async () => {
  assert.equal(envSchema.parse({ DATABASE_URL: 'test', JWT_SECRET: 'test' }).COMPANY_DRIVE_UPLOAD_JOBS_ENABLED, false);
  let calls = 0;
  const service = new CompanyRecordingJobsService(false, async () => { calls++; throw new Error('must not run'); });
  await assert.rejects(service.create(input, 'user'), /unavailable/);
  await assert.rejects(service.status('job', 'user'), /unavailable/);
  await assert.rejects(service.retry('job', 'user'), /unavailable/);
  await assert.rejects(service.validateImmediatelyBeforeFileCreation('job', 'user'), /unavailable/);
  assert.equal(calls, 0);
});
test('invalid recording metadata is rejected before database work', async () => {
  const service = new CompanyRecordingJobsService(true, async () => { throw new Error('must not run'); });
  for (const bad of [{ ...input, recordingId: 'bad' }, { ...input, byteLength: 0 }, { ...input, byteLength: 21474836481 },
    { ...input, byteLength: 1.5 }, { ...input, sha256: 'G'.repeat(64) }]) await assert.rejects(service.create(bad, 'user'));
});
