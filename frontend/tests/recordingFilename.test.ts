import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordingFilename } from '../src/lib/recordingFilename';

test('recording filename uses meeting title, configured timezone, MIME extension and unique ID', () => {
  const date=new Date('2026-11-07T20:45:00Z');
  assert.equal(recordingFilename('Class / Science','Asia/Kolkata',date,'first','video/mp4'),'Class Science - 2026-11-08 - 02-15 - first.mp4');
  assert.equal(recordingFilename('Class / Science',null,date,'second','video/webm'),'Class Science - 2026-11-07 - 20-45 - second.webm');
  assert.notEqual(recordingFilename('Class',null,date,'first','video/webm'),recordingFilename('Class',null,date,'second','video/webm'));
});
test('invalid timezone falls back to UTC and unsafe names are sanitized', () => {
  assert.equal(recordingFilename('  /:*?  ','Invalid/Zone',new Date('2026-01-02T03:04:00Z'),'id','video/webm'),'Meeting - 2026-01-02 - 03-04 - id.webm');
});
