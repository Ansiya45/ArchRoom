export type AudioInput = { local: MediaStream | null; micOn: boolean; remote: Record<string, MediaStream>; muted: Record<string, boolean> };
export type AudioMime = 'audio/webm;codecs=opus' | 'audio/webm' | 'audio/mp4';

// Owns only the mixed recording stream. Never changes/stops the meeting's tracks.
export function createSummaryCapture(transcribe: (blob: Blob, mime: AudioMime) => Promise<string>, warn: (message: string) => void) {
  if (!globalThis.AudioContext || !globalThis.MediaRecorder) throw new Error('This browser cannot capture meeting speech. Use a current Chrome, Edge, or Safari browser.');
  const mime = (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as AudioMime[]).find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('This browser has no supported audio recording format.');
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  analyser.connect(destination);
  const samples = new Float32Array(analyser.fftSize);
  const sources = new Map<string, MediaStreamAudioSourceNode>();
  const speech: string[] = [], pending = new Set<Promise<void>>();
  let stopped = false, disposed = false, recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, meter: ReturnType<typeof setInterval> | undefined;
  let clipDone = Promise.resolve(), totalChars = 0, nextClip = 0;
  const record = () => {
    if (stopped) return;
    let voiced = false, lastVoice = Date.now();
    const started = Date.now(), parts: Blob[] = [];
    recorder = new MediaRecorder(destination.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
    meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      if (samples.some(value => Math.abs(value) > 0.008)) { voiced = true; lastVoice = Date.now(); }
      // Prefer sentence pauses; force a bounded clip even during continuous speech.
      if (Date.now() - started >= 15000 && Date.now() - lastVoice > 700 && recorder?.state === 'recording') recorder.stop();
    }, 100);
    let resolveClip!: () => void;
    clipDone = new Promise<void>(resolve => { resolveClip = resolve; });
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    recorder.onerror = () => warn('Some meeting audio could not be recorded. The summary may be incomplete.');
    recorder.onstop = () => {
      clearInterval(meter); clearTimeout(timer);
      if (!disposed && voiced && parts.length) {
        const blob = new Blob(parts, { type: mime });
        if (pending.size >= 8 || totalChars >= 195000 || blob.size > 2_000_000) {
          warn('Speech processing reached its buffer limit. The summary may be incomplete.');
        } else {
          const index = nextClip++;
          const task = Promise.resolve().then(() => transcribe(blob, mime)).then(text => {
            if (disposed) return;
            if (totalChars + text.length > 195000) { warn('The summary input limit was reached; some speech is missing.'); return; }
            speech[index] = text; totalChars += text.length;
          }).catch(cause => {
            if (!disposed) warn(`${cause instanceof Error ? cause.message : 'Speech processing failed.'} The summary may be incomplete.`);
          }).finally(() => pending.delete(task));
          pending.add(task);
        }
      }
      resolveClip();
      if (!stopped) {
        try { record(); } catch { stopped = true; warn('Speech recording stopped unexpectedly. The summary may be incomplete.'); }
      }
    };
    try { recorder.start(); } catch (cause) { clearInterval(meter); resolveClip(); recorder = null; throw cause; }
    timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 25000);
  };
  const ready = context.resume().then(() => {
    if (stopped) return;
    if (context.state !== 'running') warn('Audio processing is paused by the browser. Click Enable summary capture.');
    record();
  }).catch(() => { stopped = true; warn('Audio processing could not start. The summary may be incomplete.'); });
  return {
    update(input: AudioInput) {
      if (disposed || stopped) return;
      const streams = Object.entries(input.remote).filter(([id]) => !input.muted[id]).map(([, stream]) => stream);
      if (input.micOn && input.local) streams.push(input.local);
      const tracks = new Map(streams.flatMap(stream => stream.getAudioTracks()).filter(track => track.readyState === 'live').map(track => [track.id, track]));
      for (const [id, source] of sources) if (!tracks.has(id)) { source.disconnect(); sources.delete(id); }
      for (const [id, track] of tracks) if (!sources.has(id)) {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(analyser); sources.set(id, source);
      }
    },
    async finish() {
      stopped = true; clearTimeout(timer);
      // Do not wait on resume(): browsers may leave it pending until another user gesture.
      if (context.state !== 'running') warn('Audio processing was paused. The summary may be incomplete.');
      if (recorder?.state === 'recording') recorder.stop();
      await clipDone; await Promise.all([...pending]);
      return speech.filter(Boolean).join('\n');
    },
    async resume() { await context.resume(); await ready; if (stopped && !disposed) { stopped = false; record(); } },
    dispose() {
      disposed = true; stopped = true; clearTimeout(timer); clearInterval(meter);
      if (recorder?.state === 'recording') recorder.stop();
      sources.forEach(source => source.disconnect());
      destination.stream.getTracks().forEach(track => track.stop());
      void context.close();
    },
  };
}
