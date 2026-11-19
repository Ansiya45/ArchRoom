import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { DRIVE_CHUNK_ALIGNMENT as block, MAX_RECORDING_BYTES, MAX_TRANSFER_CHUNK_BYTES, parseDriveResumeResponse, readBoundedRecordingChunk, validateRecordingChunkRange, verifyCanonicalRecordingBytes } from '../src/services/company-recording-transfer-protocol.js';

async function* stream(...chunks: Uint8Array[]) { for (const chunk of chunks) yield chunk; }

test('accepts sequential aligned chunks and a short final chunk', () => {
  const total = block * 2 + 17;
  assert.deepEqual(validateRecordingChunkRange(`bytes 0-${block - 1}/${total}`, total, 0), { start: 0, end: block - 1, total, length: block, final: false });
  assert.equal(validateRecordingChunkRange(`bytes ${block * 2}-${total - 1}/${total}`, total, block * 2).length, 17);
});

test('rejects malformed, mismatched, duplicate, oversized and unaligned chunk ranges', () => {
  const total = block * 2;
  for (const [header, size, offset] of [
    [`bytes 0-${block - 1}/${total}`, total, block],
    [`bytes ${block}-${total - 1}/${total + 1}`, total, block],
    [`bytes 0-0/${total}`, total, 0],
    [`bytes 0-${total}/${total}`, total, 0],
    [`bytes 00-${block - 1}/${total}`, total, 0],
    [`bytes 0-${MAX_TRANSFER_CHUNK_BYTES}/${MAX_TRANSFER_CHUNK_BYTES + 1}`, MAX_TRANSFER_CHUNK_BYTES + 1, 0],
    ['bytes 0-1/2', MAX_RECORDING_BYTES + 1, 0],
    [`bytes 0-${block - 1}/${total}`, total, total],
  ] as Array<[string, number, number]>) assert.throws(() => validateRecordingChunkRange(header, size, offset));
});

test('Drive acknowledgement uses provider-confirmed offsets and never claims verification', () => {
  assert.deepEqual(parseDriveResumeResponse(308, null, 100), { state: 'incomplete', confirmedOffset: 0 });
  assert.deepEqual(parseDriveResumeResponse(308, 'bytes=0-41', 100), { state: 'incomplete', confirmedOffset: 42 });
  for (const status of [200, 201]) assert.deepEqual(parseDriveResumeResponse(status, null, 100), { state: 'complete_unverified' });
  for (const status of [404, 410]) assert.deepEqual(parseDriveResumeResponse(status, null, 100), { state: 'session_expired' });
  for (const status of [429, 500, 503]) assert.deepEqual(parseDriveResumeResponse(status, null, 100), { state: 'retryable' });
  assert.deepEqual(parseDriveResumeResponse(403, null, 100), { state: 'failed' });
  for (const range of ['bytes=1-4', 'bytes=0-99', 'bytes=0-999999999999999999999', '0-42', 'bytes=0-01'])
    assert.throws(() => parseDriveResumeResponse(308, range, 100));
});

test('bounded chunk reader detects truncated and excessive bodies', async () => {
  assert.equal((await readBoundedRecordingChunk(stream(Buffer.from('ab'), Buffer.from('cd')), 4)).toString(), 'abcd');
  await assert.rejects(readBoundedRecordingChunk(stream(Buffer.from('abc')), 4));
  await assert.rejects(readBoundedRecordingChunk(stream(Buffer.from('abcde')), 4));
  await assert.rejects(readBoundedRecordingChunk(stream(), MAX_TRANSFER_CHUNK_BYTES + 1));
  async function* interrupted(): AsyncGenerator<Uint8Array> { yield Buffer.from('ab'); throw new Error('interrupted'); }
  await assert.rejects(readBoundedRecordingChunk(interrupted(), 4));
});

test('complete canonical byte stream must match actual length and SHA-256', async () => {
  const expected = createHash('sha256').update('abcd').digest('hex');
  await verifyCanonicalRecordingBytes(stream(Buffer.from('a'), Buffer.from('bcd')), 4, expected);
  await assert.rejects(verifyCanonicalRecordingBytes(stream(Buffer.from('abcd')), 4, '0'.repeat(64)));
  await assert.rejects(verifyCanonicalRecordingBytes(stream(Buffer.from('abc')), 4, expected));
  await assert.rejects(verifyCanonicalRecordingBytes(stream(Buffer.from('abcde')), 4, expected));
  await assert.rejects(verifyCanonicalRecordingBytes(stream(Buffer.from('abcd')), 4, 'bad'));
  async function* interrupted(): AsyncGenerator<Uint8Array> { yield Buffer.from('ab'); throw new Error('interrupted'); }
  await assert.rejects(verifyCanonicalRecordingBytes(interrupted(), 4, expected));
});
