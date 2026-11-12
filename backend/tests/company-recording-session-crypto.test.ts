import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { sealCompanyRecordingSession, unsealCompanyRecordingSession, type CompanyRecordingSessionBinding } from '../src/services/company-recording-session-crypto.js';

const binding: CompanyRecordingSessionBinding = {
  jobId: '11111111-1111-4111-8111-111111111111', recordingId: '22222222-2222-4222-8222-222222222222',
  ownerUserId: '33333333-3333-4333-8333-333333333333', credentialGeneration: '44444444-4444-4444-8444-444444444444',
  driveFileId: 'fileIdentifier123', companyAccountEmail: 'company@example.invalid',
};
const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic_session_123';

test('session envelope round trips with a fresh nonce and never contains the URL', () => {
  const key = randomBytes(32);
  const first = sealCompanyRecordingSession(url, binding, key), second = sealCompanyRecordingSession(url, binding, key);
  assert.notEqual(first, second); assert.ok(!first.includes('synthetic_session_123')); assert.ok(!first.includes('googleapis'));
  assert.equal(unsealCompanyRecordingSession(first, binding, key), url);
  assert.equal(unsealCompanyRecordingSession(second, binding, key), url);
});

test('Google session query parameters survive encrypted storage without plaintext leakage', () => {
  const key = randomBytes(32);
  const googleSession = `${url}&upload_protocol=resumable&session_hint=opaque_value`;
  const envelope = sealCompanyRecordingSession(googleSession, binding, key);
  assert.equal(unsealCompanyRecordingSession(envelope, binding, key), googleSession);
  assert.ok(!envelope.includes('upload_protocol') && !envelope.includes('opaque_value'));
});

test('envelope cannot be swapped across recordings, users, jobs, files, accounts, or disconnect generations', () => {
  const key = randomBytes(32); const envelope = sealCompanyRecordingSession(url, binding, key);
  const alternatives: CompanyRecordingSessionBinding[] = [
    { ...binding, jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { ...binding, recordingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...binding, ownerUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    { ...binding, credentialGeneration: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    { ...binding, driveFileId: 'anotherFileId123' }, { ...binding, companyAccountEmail: 'other@example.invalid' },
  ];
  for (const candidate of alternatives) assert.throws(() => unsealCompanyRecordingSession(envelope, candidate, key), /cannot be verified/);
  assert.throws(() => unsealCompanyRecordingSession(envelope, binding, randomBytes(32)), /cannot be verified/);
});

test('tampering, malformed envelope and invalid keys fail without exposing secrets', () => {
  const key = randomBytes(32); const envelope = sealCompanyRecordingSession(url, binding, key);
  const parts = envelope.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  for (const value of [parts.join('.'), 'v2.a.b.c', 'v1.a.b.c.extra', 'v1.@@.bad.tag', 'x'.repeat(9000)]) {
    assert.throws(() => unsealCompanyRecordingSession(value, binding, key), error => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'Company recording session cannot be verified.');
      assert.ok(!error.message.includes('synthetic_session_123')); return true;
    });
  }
  assert.throws(() => sealCompanyRecordingSession(url, binding, Buffer.alloc(31)), /Invalid recording session key/);
  assert.throws(() => unsealCompanyRecordingSession(envelope, binding, Buffer.alloc(31)), /cannot be verified/);
  assert.throws(() => sealCompanyRecordingSession(url, { ...binding, jobId: 'bad' }, key), /Invalid recording session binding/);
});

test('session URL validation rejects non-Google hosts, non-HTTPS, redirects and malformed capabilities', () => {
  const key = randomBytes(32);
  for (const value of [
    'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=token',
    'https://www.googleapis.com.evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=token',
    'https://attacker@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=token',
    'https://www.googleapis.com/upload/drive/v3/files/other?uploadType=resumable&upload_id=token',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=one&upload_id=two',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&uploadType=media&upload_id=token',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=token#fragment',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=',
  ]) assert.throws(() => sealCompanyRecordingSession(value, binding, key), /Invalid company recording session/);
});
