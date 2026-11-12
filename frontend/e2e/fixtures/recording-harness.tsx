import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useScreenRecorder } from '../../src/hooks/useScreenRecorder';
import { TopBar } from '../../src/components/meeting/TopBar';
import { RecordingPlayer } from '../../src/components/meeting/RecordingPlayer';
import { useCompanyRecordingUpload } from '../../src/hooks/useCompanyRecordingUpload';
import { CompanyRecordingUploadFeedback } from '../../src/components/meeting/CompanyRecordingUploadFeedback';
import LocalRecordingsPanel from '../../src/components/LocalRecordingsPanel';

// Exercise the real browser MediaRecorder without a screen-picker dialog.
const canvas = document.createElement('canvas');
canvas.width = 320;
canvas.height = 180;
const context = canvas.getContext('2d')!;
setInterval(() => {
  context.fillStyle = 'blue';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'white';
  context.fillText(String(performance.now()), 10, 30);
}, 50);
Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
  value: async () => canvas.captureStream(20),
});
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  value: async () => { throw new Error('No microphone in this fixture'); },
});

const audio = new AudioContext();
const tone = audio.createOscillator();
const microphone = audio.createMediaStreamDestination();
tone.connect(microphone); tone.start();
const originalCreateGain = AudioContext.prototype.createGain;
const gains: GainNode[] = [];
AudioContext.prototype.createGain = function () { const gain = originalCreateGain.call(this); gains.push(gain); return gain; };
Object.assign(window, { recordingAudio: { gains, microphone: microphone.stream } });
function Harness() {
  const [micOn, setMicOn] = useState(true);
  const [localRecovery, setLocalRecovery] = useState(false);
  const [startError, setStartError] = useState('');
  const recorder = useScreenRecorder(microphone.stream, micOn);
  const companyUpload = useCompanyRecordingUpload();
  Object.assign(window, { latestRecordingPreview: recorder.preview });
  return <>
    <button onClick={() => setLocalRecovery(true)}>Enable test recovery</button>
    {recorder.localStatus && <p>{recorder.localStatus}</p>}
    <button onClick={() => setMicOn(value => !value)}>Toggle meeting microphone</button>
    <button onClick={() => void Promise.all([recorder.stop(), recorder.stop()])}>Stop twice</button>
    {recorder.isFinalizing && <p role="status">Finalizing</p>}
    {recorder.error && <p role="alert">{recorder.error}</p>}
    {startError && <p role="alert">{startError}</p>}
    <TopBar isRecording={recorder.isRecording} recordingMs={recorder.recordingMs}
      isRecordingPaused={recorder.isPaused}
      onToggleRecordingPause={recorder.isPaused ? recorder.resume : recorder.pause}
      onOpenInfo={() => {}} layoutMode="speaker" onChangeLayout={() => {}} />
    <button onClick={() => void recorder.start(undefined, localRecovery ? { ownerId: 'test-recording-owner', passphrase: 'test-recovery-passphrase', meetingCode: 'YLM-ABC234', verifyOwner: async () => true } : undefined).catch(error => setStartError(error.message))}>Start recording</button>
    <button onClick={() => void recorder.stop()}>Stop recording</button>
    <button onClick={() => void recorder.stop().then(preview => { if (preview) return companyUpload.start(preview, 'YLM-ABC234', 'test-recording-owner'); })}>Stop and upload to company</button>
    <CompanyRecordingUploadFeedback statuses={companyUpload.statuses} onRetry={companyUpload.retry} />
    <button onClick={recorder.clearPreview}>Discard preview</button>
    <output data-testid="elapsed">{Math.floor(recorder.recordingMs)}</output>
    {recorder.preview && <output data-testid="preview"
      data-duration={recorder.preview.durationSeconds}
      data-size={recorder.preview.blob.size}
      data-mime={recorder.preview.mimeType}
      data-file-name={recorder.preview.fileName}>Ready</output>}
    {recorder.preview && <RecordingPlayer src={recorder.preview.url} durationSeconds={recorder.preview.durationSeconds} />}
    <LocalRecordingsPanel />
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
