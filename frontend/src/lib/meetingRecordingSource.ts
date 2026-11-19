export type MeetingRecordingTile = { id: string; name: string; stream: MediaStream | null; cameraOn: boolean };
export type MeetingRecordingInput = { tiles: MeetingRecordingTile[]; screen: MediaStream | null;
  localAudio: MediaStream | null; micOn: boolean; remoteAudio: Record<string, MediaStream>; remoteMuted: Record<string, boolean> };

// A single canvas and audio destination remain alive across track/layout changes.
export function createMeetingRecordingSource(getInput: () => MeetingRecordingInput) {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Meeting recording composition is unavailable.');
  const canvasStream = canvas.captureStream(12);
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const videos = new Map<string, HTMLVideoElement>();
  const sources = new Map<string, MediaStreamAudioSourceNode>();
  const output = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
  let stopped = false;

  const videoFor = (id: string, stream: MediaStream | null) => {
    const track = stream?.getVideoTracks().find(item => item.readyState === 'live');
    let video = videos.get(id);
    if (!track) { if (video) { video.pause(); video.srcObject = null; videos.delete(id); } return null; }
    if (!video) { video = document.createElement('video'); video.muted = true; video.playsInline = true; videos.set(id, video); }
    if (!(video.srcObject as MediaStream | null)?.getVideoTracks().includes(track)) {
      video.srcObject = new MediaStream([track]); void video.play().catch(() => {});
    }
    return video;
  };
  const paint = (id: string, name: string, stream: MediaStream | null, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#111827'; ctx.fillRect(x, y, w, h);
    const video = videoFor(id, stream);
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      ctx.drawImage(video, x + (w - width) / 2, y + (h - height) / 2, width, height);
    } else {
      ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.max(16, Math.min(w, h) / 7)}px sans-serif`;
      ctx.fillText(name.trim()[0]?.toUpperCase() || '?', x + w / 2, y + h / 2);
    }
    ctx.fillStyle = 'rgba(15,23,42,.8)'; ctx.fillRect(x + 4, y + h - 25, Math.min(w - 8, 180), 21);
    ctx.fillStyle = '#e2e8f0'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 25), x + 8, y + h - 14, Math.max(0, Math.min(w - 16, 172)));
  };
  const draw = () => {
    if (stopped) return;
    const { tiles, screen } = getInput();
    ctx.fillStyle = '#0b0f19'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const active = new Set(tiles.map(tile => tile.id));
    if (screen) { active.add('recording-screen'); paint('recording-screen', 'Shared screen', screen, 0, 0, 840, 720); }
    const x0 = screen ? 844 : 0, areaWidth = screen ? 436 : 1280;
    const count = Math.max(1, tiles.length), cols = screen ? (count <= 3 ? 1 : 2) : count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(count / cols), width = areaWidth / cols, height = 720 / rows;
    tiles.forEach((tile, index) => paint(tile.id, tile.name, tile.cameraOn ? tile.stream : null,
      x0 + index % cols * width + 2, Math.floor(index / cols) * height + 2, width - 4, height - 4));
    for (const [id, video] of videos) if (!active.has(id)) { video.pause(); video.srcObject = null; videos.delete(id); }
  };
  const syncAudio = () => {
    if (stopped) return;
    const input = getInput();
    const streams = Object.entries(input.remoteAudio).filter(([id]) => !input.remoteMuted[id]).map(([, stream]) => stream);
    if (input.micOn && input.localAudio) streams.push(input.localAudio);
    const tracks = new Map(streams.flatMap(stream => stream.getAudioTracks()).filter(track => track.readyState === 'live').map(track => [track.id, track]));
    for (const [id, source] of sources) if (!tracks.has(id)) { source.disconnect(); sources.delete(id); }
    for (const [id, track] of tracks) if (!sources.has(id)) { const source = audio.createMediaStreamSource(new MediaStream([track])); source.connect(destination); sources.set(id, source); }
  };
  void audio.resume().catch(() => {}); syncAudio(); draw();
  const drawTimer = window.setInterval(draw, 83), audioTimer = window.setInterval(syncAudio, 500);
  return { stream: output, close() {
    if (stopped) return; stopped = true; clearInterval(drawTimer); clearInterval(audioTimer);
    sources.forEach(source => source.disconnect()); videos.forEach(video => { video.pause(); video.srcObject = null; });
    output.getTracks().forEach(track => track.stop()); void audio.close().catch(() => {});
  } };
}
