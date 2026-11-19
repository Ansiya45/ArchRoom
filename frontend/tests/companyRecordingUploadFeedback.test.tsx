import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyRecordingUploadFeedback } from '../src/components/meeting/CompanyRecordingUploadFeedback';
import { RecordingsModal } from '../src/components/meeting/RecordingsModal';

const status = {recordingId:'recording',fileName:'recording.webm',stage:'unavailable',stagedBytes:0,totalBytes:10,driveBytes:0};
test('unavailable company upload does not claim a completed upload', () => {
  const html=renderToStaticMarkup(<CompanyRecordingUploadFeedback statuses={[status]} onRetry={()=>{}} />);
  assert.match(html,/Company Drive upload is unavailable/);
  assert.doesNotMatch(html,/available in Meeting History/);
});
test('confirmed byte counts and retry are shown only for their server stages', () => {
  const uploading=renderToStaticMarkup(<CompanyRecordingUploadFeedback statuses={[{...status,stage:'uploading_to_drive',driveBytes:3}]} onRetry={()=>{}} />);
  assert.match(uploading,/3 \/ 10 bytes confirmed by Drive/);
  assert.doesNotMatch(uploading,/Retry upload|available in Meeting History/);
  const failed=renderToStaticMarkup(<CompanyRecordingUploadFeedback statuses={[{...status,stage:'retryable_failure'}]} onRetry={()=>{}} />);
  assert.match(failed,/Retry upload/);
  const completed=renderToStaticMarkup(<CompanyRecordingUploadFeedback statuses={[{...status,stage:'completed'}]} onRetry={()=>{}} />);
  assert.match(completed,/available in Meeting History/);
});
test('an existing job keeps its original folder in the recording dialog', () => {
  const html=renderToStaticMarkup(<RecordingsModal isOpen meetingCode="YLM-TEST01"
    preview={{recordingId:'recording',fileName:'recording.webm',url:'blob:mock',durationSeconds:2,blob:new Blob(['recording'])} as any}
    onClose={()=>{}} onDiscardPreview={()=>{}} allowUpload onCompanyUpload={()=>{}}
    companyUploads={[{...status,stage:'manual_reconciliation',jobId:'existing-job'}]} />);
  assert.match(html,/This recording already has an upload job for its original folder/);
  assert.match(html,/id="recording-upload-folder"[^>]*disabled/);
});
