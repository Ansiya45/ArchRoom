import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordingVideoBitrate } from '../src/lib/recordingEncoding.ts';
test('1080p VP9 uses the smaller target without starving 4K or high motion captures', () => {
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 1920, height: 1080, frameRate: 30 }), 2_000_000);
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 3840, height: 2160, frameRate: 30 }), 8_000_000);
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 1920, height: 1080, frameRate: 60 }), 4_000_000);
});
test('unknown capture settings and fallback codecs retain browser defaults', () => {
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', {}), undefined);
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp8,opus', { width: 1920, height: 1080, frameRate: 30 }), undefined);
});
test('static screen capture retains enough budget for text detail', () => {
  assert.equal(recordingVideoBitrate('video/webm;codecs=vp9,opus', { width: 1920, height: 1080, frameRate: 1 }), 2_000_000);
});
