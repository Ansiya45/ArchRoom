import { test, expect } from '@playwright/test';

test('finalized recording plays, seeks, and changes speed', async ({ page }) => {
  await page.route('**/recording-harness', route => route.fulfill({
    contentType: 'text/html',
    body: `<div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/e2e/fixtures/recording-harness.tsx');
    </script>`,
  }));
  await page.goto('/recording-harness');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId('elapsed').textContent())).toBeGreaterThan(3000);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const preview = page.getByTestId('preview');
  await expect(preview).toHaveText('Ready');
  const supportsMp4 = await page.evaluate(() => [
    'video/mp4;codecs=avc1.424028,mp4a.40.2',
    'video/mp4;codecs=avc3.424028,mp4a.40.2',
    'video/mp4',
  ].some(type => MediaRecorder.isTypeSupported(type)));
  if (supportsMp4) {
    await expect(preview).toHaveAttribute('data-mime', 'video/mp4');
    await expect(preview).toHaveAttribute('data-file-name', /\.mp4$/);
  }
  const video = page.getByLabel('Recording video');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((node: HTMLVideoElement) => Number.isFinite(node.duration))).toBe(true);
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('2');
  expect(await video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(2);
  await page.getByRole('slider', { name: 'Seek recording' }).fill('2');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Rewind 10 seconds' }).click();
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBe(0);
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const controlsFit = await page.getByRole('button', { name: 'Fullscreen recording' }).evaluate(node =>
    node.getBoundingClientRect().right <= document.documentElement.clientWidth);
  expect(controlsFit).toBe(true);
});
