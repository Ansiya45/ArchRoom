import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { COMPANY_RECORDING_CHUNK_BYTES, stageCanonicalRecording, type CompanyUploadApi, type StagingProgress } from '../src/lib/companyRecordingUpload';

const jobId = '00000000-0000-4000-8000-000000000001';
const recordingId = '00000000-0000-4000-8000-000000000002';
const recordingStartedAt = '2026-01-02T03:04:00.000Z';
function mockApi(blob: Blob) {
  let offset = 0, verified = false, requests = 0, processCalls = 0, createCalls = 0;
  let loseResponse = false, badVerification = false;
  const received: Blob[] = [];
  const progress = (): StagingProgress => ({ jobId, recordingId, mimeType: blob.type, byteLength: blob.size,
    ingestionOffset: offset, ingestionState: verified ? 'verified' : 'unverified' });
  const api: CompanyUploadApi = {
    async createJob(input) {
      createCalls++;
      assert.equal(input.recordingId, recordingId);
      assert.equal(input.recordingStartedAt, recordingStartedAt);
      assert.equal(input.sha256, createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'));
      return { id: jobId, recordingId };
    },
    async progress() { return progress(); },
    async chunk(_job, _recording, range, bytes) {
      requests++;
      assert.equal(range, `bytes ${offset}-${offset + bytes.size - 1}/${blob.size}`);
      received.push(bytes); offset += bytes.size;
      if (loseResponse) { loseResponse = false; throw new Error('Mock response lost'); }
      return progress();
    },
    async verify() { if (!badVerification) verified = true; return progress(); },
    async requestProcessing() { processCalls++; },
  };
  return { api, received, counts: () => ({ requests, processCalls, createCalls }),
    loseNextResponse: () => { loseResponse = true; }, failVerification: () => { badVerification = true; } };
}

test('stages original canonical bytes in bounded aligned chunks before requesting processing', async () => {
  const blob = new Blob([new Uint8Array(COMPANY_RECORDING_CHUNK_BYTES + 3).fill(7)], { type: 'video/webm' });
  const mock = mockApi(blob); const updates: string[] = [];
  const result = await stageCanonicalRecording({ recordingId, meetingCode: 'YLM-TEST', destinationFolderId: 'authorizedFolder123', recordingStartedAt, canonicalBlob: blob }, {
    ...mock.api, createJob: async input => { assert.equal(input.destinationFolderId, 'authorizedFolder123'); return mock.api.createJob(input); },
  }, update => updates.push(update.stage));
  assert.deepEqual(result, { jobId, recordingId });
  assert.deepEqual(mock.received.map(part => part.size), [COMPANY_RECORDING_CHUNK_BYTES, 3]);
  assert.deepEqual(Buffer.from(await new Blob(mock.received).arrayBuffer()), Buffer.from(await blob.arrayBuffer()));
  assert.equal(mock.counts().processCalls, 1);
  assert.equal(updates.at(-1), 'processing_requested');
});

test('passes the selected child or explicit root to job creation without changing the recording ID', async () => {
  const blob=new Blob(['recording'],{type:'video/mp4'});
  for (const destinationFolderId of ['1SOsGSLZDpKrQ2OxAbKflTw2LQVZWvx2_',null]) {
    const mock=mockApi(blob);
    await stageCanonicalRecording({recordingId,meetingCode:'YLM-TEST',recordingStartedAt,destinationFolderId,canonicalBlob:blob},
      {...mock.api,createJob:async input=>{
        assert.equal(input.recordingId,recordingId);
        assert.equal(input.destinationFolderId,destinationFolderId);
        return mock.api.createJob(input);
      }});
    assert.equal(mock.counts().createCalls,1);
  }
});

test('a lost chunk acknowledgement resumes from the server offset with the same recording identity', async () => {
  const blob = new Blob([new Uint8Array(COMPANY_RECORDING_CHUNK_BYTES + 1)], { type: 'video/mp4' });
  const mock = mockApi(blob); mock.loseNextResponse();
  const input = { recordingId, meetingCode: 'YLM-TEST', recordingStartedAt, canonicalBlob: blob };
  await assert.rejects(stageCanonicalRecording(input, mock.api));
  assert.equal(mock.counts().processCalls, 0);
  await stageCanonicalRecording(input, mock.api);
  assert.deepEqual(mock.received.map(part => part.size), [COMPANY_RECORDING_CHUNK_BYTES, 1]);
  assert.deepEqual(mock.counts(), { requests: 2, processCalls: 1, createCalls: 2 });
});

test('does not request Drive processing for an unverified or invalid recording', async () => {
  const blob = new Blob(['canonical'], { type: 'video/webm' });
  const mock = mockApi(blob); mock.failVerification();
  await assert.rejects(stageCanonicalRecording({ recordingId, meetingCode: 'YLM-TEST', recordingStartedAt, canonicalBlob: blob }, mock.api));
  assert.equal(mock.counts().processCalls, 0);
  await assert.rejects(stageCanonicalRecording({ recordingId, meetingCode: 'YLM-TEST', canonicalBlob: new Blob([]) }, mock.api));
});
