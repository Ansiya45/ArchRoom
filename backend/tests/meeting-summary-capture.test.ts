import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSummaryCapture } from '../../frontend/src/lib/meetingSummaryCapture.js';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fakeBrowser(run: (f: any) => Promise<void>) {
  const originals = { AudioContext: globalThis.AudioContext, MediaRecorder: globalThis.MediaRecorder, MediaStream: globalThis.MediaStream };
  const captures: any[] = [], sources: any[] = [], warnings: string[] = [];
  let voice = 0.1, resumes = 0;
  const owned = { stopped: false, stop() { this.stopped = true; } };
  class Stream { constructor(public tracks: any[]) {} getAudioTracks() { return this.tracks; } getTracks() { return this.tracks; } }
  class Context {
    state = 'running'; createMediaStreamDestination() { return { stream: new Stream([owned]) }; }
    createAnalyser() { return { fftSize: 32, connect() {}, getFloatTimeDomainData(array: Float32Array) { array.fill(voice); } }; }
    createMediaStreamSource(stream: Stream) { const source = { stream, disconnected: false, connect() {}, disconnect() { this.disconnected = true; } }; sources.push(source); return source; }
    async resume() { resumes++; } async close() { this.state = 'closed'; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; ondataavailable: any; onstop: any;
    constructor() { captures.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }); }
  }
  Object.assign(globalThis, { AudioContext: Context, MediaStream: Stream, MediaRecorder: Recorder });
  try { await run({ Stream, captures, sources, warnings, owned, warn: (s: string) => warnings.push(s), setVoice: (n: number) => { voice = n; } }); }
  finally { Object.assign(globalThis, originals); }
}
test('capture mixes only unmuted microphone tracks and never stops meeting tracks', async () => fakeBrowser(async ({ Stream, sources, owned, warn }) => {
  const local = { id: 'local', readyState: 'live', stopped: false, stop() { this.stopped = true; } };
  const remote = { ...local, id: 'remote' };
  const capture = createSummaryCapture(async () => 'Speech', warn);
  try {
    capture.update({ local: new Stream([local]) as any, micOn: true, remote: { guest: new Stream([remote]) as any }, muted: {} });
    assert.equal(sources.length, 2);
    capture.update({ local: new Stream([local]) as any, micOn: false, remote: { guest: new Stream([remote]) as any }, muted: {} });
    assert.equal(sources.find((s: any) => s.stream.tracks[0] === local).disconnected, true);
    await delay(120);
    assert.equal(await capture.finish(), 'Speech');
  } finally { capture.dispose(); }
  assert.equal(local.stopped, false); assert.equal(remote.stopped, false); assert.equal(owned.stopped, true);
}));
test('finish flushes final audio and waits for asynchronous transcription in capture order', async () => fakeBrowser(async ({ captures, warn }) => {
  const resolve: Array<(text: string) => void> = [];
  const capture = createSummaryCapture(() => new Promise<string>(r => resolve.push(r)), warn);
  try {
    await delay(120); captures[0].stop(); await delay(120);
    let finished = false;
    const result = capture.finish().then(text => { finished = true; return text; });
    await delay(0); assert.equal(resolve.length, 2); assert.equal(finished, false);
    resolve[1]('Second'); resolve[0]('First');
    assert.equal(await result, 'First\nSecond'); assert.equal(captures.length, 2);
    assert.equal(await capture.finish(), 'First\nSecond');
  } finally { capture.dispose(); }
}));
test('silent clips are not sent to AI; provider errors are reported instead of invented speech', async () => fakeBrowser(async ({ setVoice, warn, warnings }) => {
  let calls = 0; setVoice(0);
  const capture = createSummaryCapture(async () => { calls++; throw new Error('Provider unavailable'); }, warn);
  try {
    await delay(120); assert.equal(await capture.finish(), ''); assert.equal(calls, 0);
    setVoice(0.1); await capture.resume(); await delay(120);
    assert.equal(await capture.finish(), ''); assert.equal(calls, 1);
    assert.match(warnings.at(-1), /incomplete/);
  } finally { capture.dispose(); }
}));
test('disposing a capture does not upload a final clip or stop participant tracks', async () => fakeBrowser(async ({ warn }) => {
  let calls = 0; const capture = createSummaryCapture(async () => { calls++; return 'Speech'; }, warn);
  await delay(120); capture.dispose(); await delay(0); assert.equal(calls, 0);
}));

test('recorder startup failure reports an error and cannot trap the host in finish', async () => fakeBrowser(async ({ warn, warnings }) => {
  const recorder = globalThis.MediaRecorder;
  (recorder as any).prototype.start = () => { throw new Error('Recording unavailable'); };
  const capture = createSummaryCapture(async () => 'Never uploaded', warn);
  try {
    await delay(0);
    assert.equal(await capture.finish(), '');
    assert.match(warnings.at(-1), /could not start/);
  } finally { capture.dispose(); }
}));
