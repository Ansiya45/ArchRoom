import { createHash, timingSafeEqual } from 'node:crypto';

// These primitives do not initiate uploads or trust client-provided offsets.
export const DRIVE_CHUNK_ALIGNMENT = 256 * 1024;
export const MAX_TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 20 * 1024 * 1024 * 1024;

export type RecordingChunkRange = { start: number; end: number; total: number; length: number; final: boolean };

function validTotal(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_RECORDING_BYTES;
}

// confirmedOffset must be obtained from the server-side job/Drive reconciliation,
// never from a client assertion.
export function validateRecordingChunkRange(header: string, jobSize: number, confirmedOffset: number): RecordingChunkRange {
  if (!validTotal(jobSize) || !Number.isSafeInteger(confirmedOffset) || confirmedOffset < 0 || confirmedOffset >= jobSize)
    throw new Error('Invalid recording transfer state.');
  const match = /^bytes (0|[1-9]\d*)-(0|[1-9]\d*)\/(0|[1-9]\d*)$/.exec(header);
  if (!match) throw new Error('Invalid recording chunk range.');
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || total !== jobSize || start !== confirmedOffset || end < start || end >= total)
    throw new Error('Invalid recording chunk range.');
  const length = end - start + 1;
  const final = end === total - 1;
  if (length > MAX_TRANSFER_CHUNK_BYTES || (!final && length % DRIVE_CHUNK_ALIGNMENT !== 0))
    throw new Error('Invalid recording chunk size.');
  return { start, end, total, length, final };
}

export type DriveResumeResult =
  | { state: 'incomplete'; confirmedOffset: number }
  | { state: 'complete_unverified' }
  | { state: 'session_expired' }
  | { state: 'retryable' }
  | { state: 'failed' };

// A successful Drive response is intentionally not called verified completion.
export function parseDriveResumeResponse(status: number, range: string | null, total: number): DriveResumeResult {
  if (!validTotal(total)) throw new Error('Invalid recording transfer state.');
  if (status === 200 || status === 201) return { state: 'complete_unverified' };
  if (status === 404 || status === 410) return { state: 'session_expired' };
  if (status === 429 || (status >= 500 && status <= 599)) return { state: 'retryable' };
  if (status !== 308) return { state: 'failed' };
  if (range === null) return { state: 'incomplete', confirmedOffset: 0 };
  const match = /^bytes=0-(0|[1-9]\d*)$/.exec(range);
  if (!match) throw new Error('Invalid Drive upload acknowledgement.');
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte) || lastByte >= total - 1) throw new Error('Invalid Drive upload acknowledgement.');
  return { state: 'incomplete', confirmedOffset: lastByte + 1 };
}

// A future authenticated endpoint must apply a deadline/abort to its input
// stream and must not forward a chunk until this bounded read has succeeded.
export async function readBoundedRecordingChunk(source: AsyncIterable<Uint8Array>, expectedLength: number): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > MAX_TRANSFER_CHUNK_BYTES)
    throw new Error('Invalid recording chunk size.');
  const chunk = Buffer.allocUnsafe(expectedLength); let received = 0;
  for await (const part of source) {
    if (!(part instanceof Uint8Array)) throw new Error('Invalid recording chunk data.');
    if (part.byteLength > expectedLength - received) throw new Error('Recording chunk length does not match.');
    chunk.set(part, received);
    received += part.byteLength;
  }
  if (received !== expectedLength) throw new Error('Recording chunk length does not match.');
  return chunk;
}

// Verifies a complete stream, not an incremental or client-supplied hash
// checkpoint. A future transfer implementation must bind these exact bytes to
// the bytes received by Drive and reconcile interruptions independently.
export async function verifyCanonicalRecordingBytes(source: AsyncIterable<Uint8Array>, expectedSize: number, expectedSha256: string): Promise<void> {
  if (!validTotal(expectedSize) || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid recording metadata.');
  const hash = createHash('sha256'); let received = 0;
  for await (const part of source) {
    if (!(part instanceof Uint8Array)) throw new Error('Invalid recording data.');
    received += part.byteLength;
    if (!Number.isSafeInteger(received) || received > expectedSize) throw new Error('Recording size does not match.');
    hash.update(part);
  }
  if (received !== expectedSize || !timingSafeEqual(hash.digest(), Buffer.from(expectedSha256, 'hex')))
    throw new Error('Recording integrity could not be verified.');
}
