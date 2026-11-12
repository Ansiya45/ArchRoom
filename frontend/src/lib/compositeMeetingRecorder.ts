import { preferredRecordingMimeType, recordingVideoBitrate, RECORDING_AUDIO_BITRATE } from './recordingEncoding';

// Records the meeting itself — every participant's video laid out in a canvas
// grid plus everyone's audio mixed through an AudioContext — rather than
// capturing whatever screen surface the host happens to pick. This removes
// the "host chose the wrong window / tab audio was off / macOS can't capture
// remote voices" failure modes entirely, and keeps recording through LiveKit
// reconnects because the source streams are local objects, not a display
// capture that dies with the browser picker.

export type RecorderTile = { id: string; name: string; stream: MediaStream };
export type RecorderAudioInput = {
  local: MediaStream | null;
  micOn: boolean;
  remote: Record<string, MediaStream>;
  muted: Record<string, boolean>;
};

export type CompositeRecorderOptions = {
  getTiles: () => RecorderTile[];
  getAudio: () => RecorderAudioInput;
  onChunk: (blob: Blob) => void;
  onError?: (message: string) => void;
};

const CANVAS_W = 1280;
const CANVAS_H = 720;
const FPS = 12;
const TIMESLICE_MS = 10_000;

export function createCompositeMeetingRecorder({ getTiles, getAudio, onChunk, onError }: CompositeRecorderOptions) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot compose the meeting recording.');

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const audioSources = new Map<string, MediaStreamAudioSourceNode>();

  const videoElements = new Map<string, HTMLVideoElement>();
  const canvasStream = canvas.captureStream(FPS);
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const mimeType = preferredRecordingMimeType(type => MediaRecorder.isTypeSupported(type));
  const videoBitsPerSecond = recordingVideoBitrate(mimeType, { width: CANVAS_W, height: CANVAS_H, frameRate: FPS });
  const recorder = new MediaRecorder(combined, {
    ...(mimeType ? { mimeType } : {}),
    ...(videoBitsPerSecond ? { videoBitsPerSecond } : {}),
    audioBitsPerSecond: RECORDING_AUDIO_BITRATE,
  });

  recorder.ondataavailable = event => { if (event.data.size) onChunk(event.data); };
  recorder.onerror = () => onError?.('The meeting recorder reported a failure. The recording may be incomplete.');

  let drawTimer: ReturnType<typeof setInterval> | null = null;
  let syncTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const syncAudio = () => {
    const input = getAudio();
    const streams = Object.entries(input.remote)
      .filter(([id]) => !input.muted[id])
      .map(([, stream]) => stream);
    if (input.micOn && input.local) streams.push(input.local);
    const wanted = new Map(
      streams.flatMap(stream => stream.getAudioTracks())
        .filter(track => track.readyState === 'live')
        .map(track => [track.id, track])
    );
    for (const [id, source] of audioSources) {
      if (!wanted.has(id)) { source.disconnect(); audioSources.delete(id); }
    }
    for (const [id, track] of wanted) {
      if (!audioSources.has(id)) {
        const source = audioContext.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        audioSources.set(id, source);
      }
    }
  };

  const syncVideos = (tiles: RecorderTile[]) => {
    const wanted = new Set(tiles.map(tile => tile.id));
    for (const [id, video] of videoElements) {
      if (!wanted.has(id)) {
        video.pause();
        video.srcObject = null;
        videoElements.delete(id);
      }
    }
    for (const tile of tiles) {
      const videoTrack = tile.stream.getVideoTracks().find(track => track.readyState === 'live');
      const existing = videoElements.get(tile.id);
      if (existing) {
        if (!videoTrack && existing.srcObject) { existing.srcObject = null; }
        else if (videoTrack && !(existing.srcObject as MediaStream | null)?.getVideoTracks().includes(videoTrack)) {
          existing.srcObject = new MediaStream([videoTrack]);
          void existing.play().catch(() => undefined);
        }
      } else if (videoTrack) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = new MediaStream([videoTrack]);
        videoElements.set(tile.id, video);
        void video.play().catch(() => undefined);
      }
    }
  };

  const draw = () => {
    if (stopped) return;
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const tiles = getTiles();
    syncVideos(tiles);
    if (!tiles.length) return;
    const count = tiles.length;
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(count / cols);
    const tileW = CANVAS_W / cols;
    const tileH = CANVAS_H / rows;
    tiles.slice(0, cols * rows).forEach((tile, index) => {
      const x = (index % cols) * tileW;
      const y = Math.floor(index / cols) * tileH;
      const video = videoElements.get(tile.id);
      ctx.fillStyle = '#111827';
      ctx.fillRect(x + 2, y + 2, tileW - 4, tileH - 4);
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
        const scale = Math.min((tileW - 4) / video.videoWidth, (tileH - 4) / video.videoHeight);
        const w = video.videoWidth * scale;
        const h = video.videoHeight * scale;
        ctx.drawImage(video, x + 2 + (tileW - 4 - w) / 2, y + 2 + (tileH - 4 - h) / 2, w, h);
      } else {
        // Camera off or track not yet delivering frames: draw the initial.
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(x + tileW / 2, y + tileH / 2, Math.min(tileW, tileH) / 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${Math.min(tileW, tileH) / 8}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((tile.name.trim()[0] || '?').toUpperCase(), x + tileW / 2, y + tileH / 2);
      }
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      const label = tile.name.slice(0, 28);
      ctx.font = '14px sans-serif';
      const labelW = ctx.measureText(label).width + 16;
      ctx.fillRect(x + 6, y + tileH - 30, labelW, 22);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 14, y + tileH - 19);
    });
  };

  return {
    mimeType: mimeType || 'video/webm',
    start() {
      stopped = false;
      void audioContext.resume().catch(() => undefined);
      syncAudio();
      syncTimer = setInterval(syncAudio, 1000);
      draw();
      drawTimer = setInterval(draw, Math.round(1000 / FPS));
      recorder.start(TIMESLICE_MS);
    },
    pause() { if (recorder.state === 'recording') recorder.pause(); },
    resume() {
      if (recorder.state === 'paused') recorder.resume();
      void audioContext.resume().catch(() => undefined);
    },
    // Flushes the last buffered segment, then tears the recorder down.
    async stop() {
      stopped = true;
      if (drawTimer) { clearInterval(drawTimer); drawTimer = null; }
      if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
      await new Promise<void>(resolve => {
        if (recorder.state === 'inactive') { resolve(); return; }
        const previous = recorder.onstop;
        recorder.onstop = event => { previous?.call(recorder, event); resolve(); };
        recorder.stop();
      });
      audioSources.forEach(source => source.disconnect());
      videoElements.forEach(video => { video.pause(); video.srcObject = null; });
      canvasStream.getTracks().forEach(track => track.stop());
      destination.stream.getTracks().forEach(track => track.stop());
      void audioContext.close().catch(() => undefined);
    },
  };
}
