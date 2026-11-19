import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';

function clock(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function RecordingPlayer({ src, durationSeconds }: { src: string; durationSeconds: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setTime(0);
    setDuration(durationSeconds);
    setPlaying(false);
  }, [src, durationSeconds]);

  const seek = (target: number) => {
    const node = video.current;
    if (!node) return;
    const limit = Number.isFinite(node.duration) ? node.duration : duration;
    node.currentTime = Math.max(0, Math.min(limit, target));
    setTime(node.currentTime);
  };

  const toggle = () => {
    const node = video.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  };

  return <div className="overflow-hidden rounded-xl bg-slate-950 text-white">
    <video
      ref={video} src={src} playsInline preload="metadata"
      className="aspect-video w-full bg-black" aria-label="Recording video"
      onClick={toggle}
      onLoadedMetadata={event => {
        const value = event.currentTarget.duration;
        if (Number.isFinite(value) && value > 0) setDuration(value);
      }}
      onDurationChange={event => {
        const value = event.currentTarget.duration;
        if (Number.isFinite(value) && value > 0) setDuration(value);
      }}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
    />
    <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <button type="button" onClick={toggle} className="inline-flex h-8 w-9 items-center justify-center rounded hover:bg-white/20" aria-label={playing ? 'Pause playback' : 'Play recording'} title={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5" fill="currentColor" />}
      </button>
      <button type="button" onClick={() => seek(time - 10)} className="inline-flex h-8 w-9 items-center justify-center rounded hover:bg-white/20" aria-label="Rewind 10 seconds" title="Back 10 seconds">
        <span className="relative inline-flex h-6 w-6 items-center justify-center"><RotateCcw className="h-6 w-6" /><span className="absolute mt-1 text-[8px] font-bold">10</span></span>
      </button>
      <button type="button" onClick={() => seek(time + 10)} className="inline-flex h-8 w-9 items-center justify-center rounded hover:bg-white/20" aria-label="Forward 10 seconds" title="Forward 10 seconds">
        <span className="relative inline-flex h-6 w-6 items-center justify-center"><RotateCw className="h-6 w-6" /><span className="absolute mt-1 text-[8px] font-bold">10</span></span>
      </button>
      <label className="min-w-[120px] flex-1">
        <span className="sr-only">Seek recording</span>
        <input type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(time, Math.max(1, duration))}
          onChange={event => seek(Number(event.target.value))} className="w-full accent-violet-500" aria-label="Seek recording" />
      </label>
      <span aria-live="off">{clock(time)} / {clock(duration)}</span>
      <label className="flex items-center gap-1">Speed
        <select aria-label="Playback speed" value={speed} onChange={event => {
          const value = Number(event.target.value);
          if (video.current) {
            video.current.playbackRate = value;
            video.current.preservesPitch = true;
          }
          setSpeed(value);
        }} className="rounded bg-slate-800 p-1 text-white">
          {[0.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
      <button type="button" onClick={() => {
        if (!video.current) return;
        video.current.muted = !video.current.muted;
        setMuted(video.current.muted);
      }} className="inline-flex h-8 w-9 items-center justify-center rounded hover:bg-white/20" aria-label={muted ? 'Unmute recording' : 'Mute recording'} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>
      <label className="flex items-center gap-1"><span className="sr-only">Volume</span>
        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => {
          const value = Number(event.target.value);
          if (video.current) video.current.volume = value;
          setVolume(value);
        }} className="w-16 accent-violet-500" aria-label="Volume" />
      </label>
      <button type="button" onClick={() => void video.current?.requestFullscreen?.()} className="rounded px-2 py-1 hover:bg-white/20" aria-label="Fullscreen recording">Fullscreen</button>
    </div>
  </div>;
}
