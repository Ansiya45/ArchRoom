import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canLeaveRecordingReview, verifiedCompanyRecordingLink } from '../src/lib/companyRecordingUpload';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const occurrence = '33333333-3333-4333-8333-333333333333';
const url = 'https://drive.google.com/file/d/verifiedFile123/view';
const item = { kind: 'drive', dedupeKey: `company-drive:${first}`, occurrenceId: occurrence,
  independentlyVerified: true, content: url };

test('verified History link matches the exact recording and occurrence', () => {
  assert.equal(verifiedCompanyRecordingLink([item], first, occurrence), url);
  assert.equal(verifiedCompanyRecordingLink([item], second, occurrence), null);
  assert.equal(verifiedCompanyRecordingLink([item], first, null), null);
  assert.equal(verifiedCompanyRecordingLink([{ ...item, independentlyVerified: false }], first, occurrence), null);
  assert.equal(verifiedCompanyRecordingLink([{ ...item, dedupeKey: `drive:${first}` }], first, occurrence), null);
  assert.equal(verifiedCompanyRecordingLink([{ ...item, content: 'https://evil.invalid/file' }], first, occurrence), null);
});

test('multiple recordings keep their own verified links', () => {
  const secondUrl = 'https://drive.google.com/file/d/anotherVerifiedFile/view';
  const items = [item, { ...item, dedupeKey: `company-drive:${second}`, content: secondUrl }];
  assert.equal(verifiedCompanyRecordingLink(items, first, occurrence), url);
  assert.equal(verifiedCompanyRecordingLink(items, second, occurrence), secondUrl);
});

test('leaving requires completion for the current preview and never requires copying a link', () => {
  const uploads = [{ recordingId: second, stage: 'completed' }, { recordingId: first, stage: 'uploading_to_drive' }];
  assert.equal(canLeaveRecordingReview(first, uploads), false);
  assert.equal(canLeaveRecordingReview(first, [{ recordingId: first, stage: 'retryable_failure' }]), false);
  assert.equal(canLeaveRecordingReview(first, [{ recordingId: first, stage: 'manual_reconciliation' }]), false);
  assert.equal(canLeaveRecordingReview(first, [{ recordingId: first, stage: 'completed' }]), true);
  assert.equal(canLeaveRecordingReview(undefined, []), false);
  assert.equal(canLeaveRecordingReview(null, []), true);
});
