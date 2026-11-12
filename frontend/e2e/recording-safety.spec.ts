import { test, expect } from '@playwright/test';

async function harness(page: import('@playwright/test').Page) {
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.goto('/recording-harness');
}

for (const mode of ['delayed', 'empty', 'failed'] as const) {
  test(`recording finalization handles ${mode} data and repeated stop`, async ({ page }) => {
    await page.addInitScript(mode => {
      let stops = 0;
      class Recorder {
        static isTypeSupported() { return true; }
        state = 'inactive'; mimeType = 'video/mp4';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() { this.state = 'recording'; if (mode === 'failed') setTimeout(() => this.onerror?.(), 300); }
        pause() { this.state = 'paused'; }
        resume() { this.state = 'recording'; }
        stop() {
          stops++; this.state = 'inactive';
          setTimeout(() => {
            this.ondataavailable?.({ data: new Blob(mode === 'empty' ? [] : ['final-data'], { type: 'video/mp4' }) });
            this.onstop?.();
          }, 500);
        }
      }
      Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
      Object.defineProperty(window, 'recordingStops', { get: () => stops });
    }, mode);
    await harness(page);
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    if (mode !== 'failed') {
      await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Stop twice' }).click();
    }
    await expect(page.getByText('Finalizing', { exact: true })).toBeVisible();
    await expect(page.getByTestId('preview')).toBeHidden();
    if (mode === 'empty') {
      await expect(page.getByRole('alert')).toContainText('No recording data');
      await expect(page.getByTestId('preview')).toBeHidden();
    } else {
      await expect(page.getByTestId('preview')).toHaveAttribute('data-size', '10');
      if (mode === 'failed') await expect(page.getByRole('alert')).toContainText('Recording failed');
    }
    await expect(page.getByText('Finalizing', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => (window as any).recordingStops)).toBe(1);
  });
}

test('recording reuses meeting microphone, follows mute, and never stops the meeting track', async ({ page }) => {
  await harness(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  const gain = () => page.evaluate(() => (window as any).recordingAudio.gains.at(-1).gain.value);
  expect(await gain()).toBe(1);
  await page.getByRole('button', { name: 'Toggle meeting microphone' }).click();
  await expect.poll(gain).toBe(0);
  await page.getByRole('button', { name: 'Toggle meeting microphone' }).click();
  await expect.poll(gain).toBe(1);
  await page.getByRole('button', { name: 'Stop twice' }).click();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  expect(await page.evaluate(() => (window as any).recordingAudio.microphone.getAudioTracks()[0].readyState)).toBe('live');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
});
