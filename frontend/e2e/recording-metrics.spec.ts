import { test, expect } from '@playwright/test';

test('measures a mixed presentation and motion sample with audio', async ({ page }) => {
  await page.goto('/');
  const sample = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(15);
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const destination = audio.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    oscillator.connect(destination);
    oscillator.start();
    stream.addTrack(destination.stream.getAudioTracks()[0]);
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type))!;
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: mimeType.includes('vp9') ? 600_000 : 950_000, audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    const started = performance.now();
    let frame = 0;
    const draw = () => {
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, 1920, 1080);
      context.fillStyle = '#0f172a';
      context.font = '30px sans-serif';
      context.fillText('Presentation: readable screen text at 1080p', 40, 70);
      context.font = '22px sans-serif';
      for (let row = 0; row < 14; row++) context.fillText(`Quarterly review — section ${row + 1}: 1234567890`, 40, 120 + row * 34);
      context.fillStyle = '#6366f1';
      context.beginPath();
      context.arc(900 + Math.sin(frame / 8) * 120, 350, 110, 0, Math.PI * 2);
      context.fill();
      frame++;
    };
    draw();
    const timer = setInterval(draw, 1000 / 15);
    recorder.start(1000);
    await new Promise(resolve => setTimeout(resolve, 8000));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    oscillator.stop();
    stream.getTracks().forEach(track => track.stop());
    await audio.close();
    const seconds = (performance.now() - started) / 1000;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const video = document.createElement('video');
    video.src = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Sample cannot load')); });
    const seekable = Number.isFinite(video.duration) && video.duration > 0;
    URL.revokeObjectURL(video.src);
    return { bytes: blob.size, seconds, bitrate: Math.round(blob.size * 8 / seconds), mimeType: recorder.mimeType,
      width: canvas.width, height: canvas.height, frameRate: 15, seekable };
  });
  console.log(`Recording sample: ${JSON.stringify(sample)}`);
  expect(sample.bytes).toBeGreaterThan(0);
  expect(sample.mimeType).toContain('webm');
});
