import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptRecordingNotice } from '../src/lib/recordingNotice';

test('accepts the recording lifecycle in order', () => {
  let previous = undefined;
  for (const [index, state] of (['started','paused','resumed','stopped'] as const).entries()) {
    const notice = acceptRecordingNotice({state,sentAt:1000+index},previous,1003);
    assert.ok(notice); assert.equal(notice.state,state); previous=notice;
  }
});

test('rejects duplicates, stale events, malformed and future events', () => {
  const previous = {state:'paused' as const,sentAt:1000};
  assert.equal(acceptRecordingNotice({state:'started',sentAt:1000},previous,1000),null);
  assert.equal(acceptRecordingNotice({state:'started',sentAt:999},previous,1000),null);
  assert.equal(acceptRecordingNotice({state:'started',sentAt:1},undefined,30002),null);
  assert.equal(acceptRecordingNotice({state:'started',sentAt:7000},undefined,1000),null);
  assert.equal(acceptRecordingNotice({state:'approved',sentAt:1001},previous,1001),null);
});
