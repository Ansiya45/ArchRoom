// Keep capture resolution, frame rate, and browser audio settings unchanged.
// These are encoding targets, not a guarantee of identical perceptual quality.
export function recordingVideoBitrate(mimeType: string, settings: { width?: number; height?: number; frameRate?: number }) {
  if (!mimeType.includes('vp9')) return undefined;
  const { width, height, frameRate } = settings;
  if (!width || !height || !frameRate || !Number.isFinite(width * height * frameRate)) return undefined;
  // 2 Mbps at 1080p30; give larger/faster captures proportionally more detail.
  // Do not starve low-frame-rate screen captures of bits for sharp text.
  return Math.round(Math.max(750_000, 2_000_000 * (width * height / (1920 * 1080)) * (Math.max(30, frameRate) / 30)));
}
