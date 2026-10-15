export const RECORDING_FRAME_RATE = 15;
export const RECORDING_AUDIO_BITRATE = 64_000;

export function isDriveReadyMp4(mimeType: string) {
  return mimeType.split(';')[0].trim().toLowerCase() === 'video/mp4';
}

export function preferredRecordingMimeType(isSupported: (type: string) => boolean) {
  // A genuine H.264/AAC MP4 is the most reliable format for Drive preview.
  // Runtime detection is required because MediaRecorder codecs vary by browser/OS.
  return [
    'video/mp4;codecs=avc1.424028,mp4a.40.2',
    'video/mp4;codecs=avc3.424028,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
    .find(isSupported) || '';
}

// MediaRecorder bitrates are targets; browsers may exceed them for motion.
// Capture resolution stays intact so shared-screen text is not downscaled.
export function recordingVideoBitrate(mimeType: string, settings: { width?: number; height?: number; frameRate?: number }) {
  const { width, height, frameRate } = settings;
  if (!width || !height || !Number.isFinite(width * height)) return undefined;
  const vp9 = mimeType.includes('vp9');
  const vp8 = mimeType.includes('vp8');
  const h264 = mimeType.includes('mp4') || mimeType.includes('avc1') || mimeType.includes('avc3');
  if (!vp9 && !vp8 && !h264) return undefined;
  const fps = Math.min(30, Math.max(15, frameRate || RECORDING_FRAME_RATE));
  const base = vp9 ? 600_000 : h264 ? 850_000 : 950_000;
  return Math.round(Math.max(vp9 ? 350_000 : h264 ? 550_000 : 600_000,
    base * (width * height / (1920 * 1080)) ** 0.75 * (fps / 15) ** 0.5));
}

// A metadata repair failure must never discard the only copy of a recording.
export async function repairWebmBlob(blob: Blob, durationMs: number,
  repair: (blob: Blob, durationMs: number) => Promise<Blob>) {
  try {
    const fixed = await repair(blob, durationMs);
    return fixed.size > 0 ? fixed : blob;
  } catch {
    return blob;
  }
}
