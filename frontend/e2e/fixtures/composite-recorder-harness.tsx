import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useScreenRecorder } from '../../src/hooks/useScreenRecorder';
import type { MeetingRecordingInput } from '../../src/lib/meetingRecordingSource';

function colored(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180);
  const stream = canvas.captureStream(12);
  // Canvas capture emits on changes; keep synthetic tracks producing frames.
  window.setInterval(() => { ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180); }, 80);
  return stream;
}
const first = colored('#ff0000'), second = colored('#00ff00'), screen = colored('#0000ff');
const audio = new AudioContext(), oscillator = audio.createOscillator(), mixed = audio.createMediaStreamDestination();
oscillator.connect(mixed); oscillator.start();
function Harness() {
  const input = useRef<MeetingRecordingInput>({ tiles: [{ id: 'one', name: 'One', stream: first, cameraOn: true }], screen: null,
    localAudio: mixed.stream, micOn: true, remoteAudio: {}, remoteMuted: {} });
  const getInput = useCallback(() => input.current, []);
  const [status, setStatus] = useState('idle');
  const recorder = useScreenRecorder(null, false, 'Test meeting', null, getInput);
  Object.assign(window, { compositePreview: recorder.preview });
  return <>
    <button onClick={() => void recorder.start(undefined, undefined, { ownerId: 'host', meetingCode: 'YLM-TEST' }).then(() => setStatus('recording'))}>Start</button>
    <button onClick={() => { input.current = { ...input.current, screen, tiles: [...input.current.tiles, { id: 'two', name: 'Two', stream: second, cameraOn: true }] }; }}>Share and join</button>
    <button onClick={() => { input.current = { ...input.current, screen: null, tiles: input.current.tiles.filter(tile => tile.id !== 'two') }; }}>Stop share and leave</button>
    <button onClick={() => void recorder.stop().then(() => setStatus('stopped'))}>Stop</button>
    <output data-testid="status">{status}</output><output data-testid="backup">{recorder.localStatus}</output>
    {recorder.preview && <video data-testid="video" src={recorder.preview.url} controls />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
