import { test, expect } from '@playwright/test';

test('active recorder keeps one playable recording and backup across gallery and screen transitions', async ({ page }) => {
  await page.route('**/composite-recorder-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/composite-recorder-harness.tsx');</script>` }));
  await page.goto('/composite-recorder-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'test'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'host' })); });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('recording');
  await page.waitForTimeout(2400);
  await page.getByRole('button', { name: 'Share and join' }).click();
  await page.waitForTimeout(2400);
  await page.getByRole('button', { name: 'Stop share and leave' }).click();
  await page.waitForTimeout(2400);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('stopped');
  const result = await page.evaluate(async () => {
    const preview = (window as any).compositePreview;
    const path = '/src/lib/recordingBackup.ts'; const backups = await import(/* @vite-ignore */ path);
    const [record] = await backups.listRecordingBackups('host');
    const backup = await backups.reconstructRecordingBackup('host', record.id);
    const video = document.querySelector('video')!;
    await new Promise<void>((resolve, reject) => { if (video.readyState >= 1) resolve(); else { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Video metadata unavailable')); } });
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    const sample = async (time: number, x: number, y: number) => {
      if (Math.abs(video.currentTime - time) > 0.01) await new Promise<void>((resolve, reject) => { video.onseeked = () => resolve(); video.onerror = () => reject(new Error('Video seek failed')); video.currentTime = time; });
      ctx.drawImage(video, 0, 0); return Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    };
    const gallery = await sample(1, 640, 360), shared = await sample(3.5, 420, 360), participant = await sample(3.5, 1060, 540), resumed = await sample(6, 640, 360);
    video.muted = true; await video.play();
    const audioTracks = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream().getAudioTracks().length;
    const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).join(',');
    return { id: preview.recordingId, backupId: record.id, state: record.state, count: record.count, size: preview.canonicalBlob.size,
      backupSize: backup.blob.size, width: video.videoWidth, height: video.videoHeight, mime: preview.canonicalBlob.type,
      gallery, shared, participant, resumed, audioTracks, sameBytes: await hash(preview.canonicalBlob) === await hash(backup.blob) };
  });
  expect(result.id).toBe(result.backupId); expect(result.state).toBe('complete'); expect(result.count).toBeGreaterThanOrEqual(3);
  expect(result.size).toBeGreaterThan(0); expect(result.backupSize).toBe(result.size);
  expect(result.width).toBe(1280); expect(result.height).toBe(720); expect(['video/webm', 'video/mp4']).toContain(result.mime);
  expect(result.gallery[0]).toBeGreaterThan(150); expect(result.shared[2]).toBeGreaterThan(150);
  expect(result.participant[1]).toBeGreaterThan(150); expect(result.resumed[0]).toBeGreaterThan(150);
  expect(result.audioTracks).toBeGreaterThan(0);
  expect(result.sameBytes).toBe(true);
});
