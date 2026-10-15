import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDriveReadyMp4, preferredRecordingMimeType, recordingVideoBitrate, repairWebmBlob, RECORDING_AUDIO_BITRATE, RECORDING_FRAME_RATE } from '../src/lib/recordingEncoding.ts';

test('prefers H.264/AAC MP4 and falls back to VP9, VP8, then generic WebM', () => {
  assert.equal(preferredRecordingMimeType(type => type.includes('avc1')), 'video/mp4;codecs=avc1.424028,mp4a.40.2');
  assert.equal(preferredRecordingMimeType(type => type === 'video/mp4'), 'video/mp4');
  assert.equal(preferredRecordingMimeType(type => type.includes('vp9')), 'video/webm;codecs=vp9,opus');
  assert.equal(preferredRecordingMimeType(type => type.includes('vp8')), 'video/webm;codecs=vp8,opus');
  assert.equal(preferredRecordingMimeType(type => type === 'video/webm'), 'video/webm');
  assert.equal(preferredRecordingMimeType(() => false), '');
});

test('preserves full resolution while reducing frame rate and codec-specific bitrate', () => {
  assert.equal(RECORDING_FRAME_RATE, 15);
  assert.equal(RECORDING_AUDIO_BITRATE, 64_000);
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 1920, height: 1080, frameRate: 15 }), 600_000);
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp8,opus', { width: 1920, height: 1080, frameRate: 15 }), 950_000);
  assert.equal(recordingVideoBitrate('video/mp4;codecs=avc1.424028,mp4a.40.2', { width: 1920, height: 1080, frameRate: 15 }), 850_000);
  assert.ok(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 3840, height: 2160, frameRate: 15 })! > 600_000);
  assert.ok(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 1920, height: 1080, frameRate: 30 })! > 600_000);
});

test('unknown dimensions and unsupported codecs retain browser defaults', () => {
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', {}), undefined);
  assert.equal(recordingVideoBitrate('video/webm', { width: 1920, height: 1080 }), undefined);
});

test('Drive upload accepts real MP4 media and rejects extension-only WebM files', () => {
  assert.equal(isDriveReadyMp4('video/mp4;codecs=avc1.424028,mp4a.40.2'), true);
  assert.equal(isDriveReadyMp4('video/webm'), false);
});

test('failed or empty WebM metadata repair retains the original recording', async () => {
  const original = new Blob(['original'], { type: 'video/webm' });
  assert.equal(await repairWebmBlob(original, 1000, async () => { throw new Error('repair failed'); }), original);
  assert.equal(await repairWebmBlob(original, 1000, async () => new Blob()), original);
});
