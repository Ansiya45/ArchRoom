import React from 'react';
import { createRoot } from 'react-dom/client';
import { useScreenRecorder } from '../../src/hooks/useScreenRecorder';
import { TopBar } from '../../src/components/meeting/TopBar';
import { RecordingPlayer } from '../../src/components/meeting/RecordingPlayer';

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

function Harness() {
  const recorder = useScreenRecorder();
  return <>
    <TopBar isRecording={recorder.isRecording} recordingMs={recorder.recordingMs}
      isRecordingPaused={recorder.isPaused}
      onToggleRecordingPause={recorder.isPaused ? recorder.resume : recorder.pause}
      onOpenInfo={() => {}} layoutMode="speaker" onChangeLayout={() => {}} />
    <button onClick={() => void recorder.start()}>Start recording</button>
    <button onClick={() => void recorder.stop()}>Stop recording</button>
    <output data-testid="elapsed">{Math.floor(recorder.recordingMs)}</output>
    {recorder.preview && <output data-testid="preview"
      data-duration={recorder.preview.durationSeconds}
      data-size={recorder.preview.blob.size}
      data-mime={recorder.preview.mimeType}
      data-file-name={recorder.preview.fileName}>Ready</output>}
    {recorder.preview && <RecordingPlayer src={recorder.preview.url} durationSeconds={recorder.preview.durationSeconds} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
