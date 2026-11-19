import assert from 'node:assert/strict';
import { test } from 'node:test';
import { companyRecordingFilename } from '../src/services/company-recording-filename.js';

test('uses durable meeting title, start time, timezone and recording ID',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const date=new Date('2026-11-07T20:45:00Z');
  assert.equal(companyRecordingFilename('Class / Science','Asia/Kolkata',date,id,'video/mp4'),`Class Science - 2026-11-08 - 02-15 - ${id}.mp4`);
  assert.equal(companyRecordingFilename('Class',null,date,id,'video/webm'),`Class - 2026-11-07 - 20-45 - ${id}.webm`);
  assert.notEqual(companyRecordingFilename('Class',null,date,id,'video/webm'),companyRecordingFilename('Class',null,date,'22222222-2222-4222-8222-222222222222','video/webm'));
});
