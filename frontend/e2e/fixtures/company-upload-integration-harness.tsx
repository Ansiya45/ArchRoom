import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useScreenRecorder } from '../../src/hooks/useScreenRecorder';
import { useCompanyRecordingUpload } from '../../src/hooks/useCompanyRecordingUpload';
import { CompanyRecordingUploadFeedback } from '../../src/components/meeting/CompanyRecordingUploadFeedback';
import LocalRecordingsPanel from '../../src/components/LocalRecordingsPanel';

const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>canvas.captureStream(15)});
const owner='00000000-0000-4000-8000-000000000101';
function App(){
  const recorder=useScreenRecorder();const upload=useCompanyRecordingUpload();
  const [recovery,setRecovery]=useState(false);
  Object.assign(window,{latestRecordingPreview:recorder.preview});
  return <>
    <button onClick={()=>setRecovery(true)}>Enable encrypted recovery</button>
    <button onClick={()=>void recorder.start(undefined,recovery?{ownerId:owner,passphrase:'disposable-recovery-passphrase',meetingCode:'YLM-ABC234',verifyOwner:async()=>true}:undefined)}>Start</button>
    <button onClick={recorder.pause}>Pause</button><button onClick={recorder.resume}>Resume</button>
    <button onClick={()=>void recorder.stop().then(preview=>{if(preview)void upload.start(preview,'YLM-ABC234',owner);})}>Stop</button>
    <button onClick={recorder.clearPreview}>Discard preview</button>
    <output data-testid="state">{recorder.isRecording?(recorder.isPaused?'paused':'recording'):recorder.preview?'ready':'idle'}</output>
    <CompanyRecordingUploadFeedback statuses={upload.statuses} onRetry={upload.retry} />
    {recorder.localStatus && <p>{recorder.localStatus}</p>}
    <LocalRecordingsPanel />
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
