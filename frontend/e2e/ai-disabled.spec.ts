import { test, expect } from '@playwright/test';

test('AI hook never creates capture resources or uploads audio, even with the old host activation signal', async ({ page }) => {
  const audioRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('transcribeSpeech')) audioRequests.push(request.url()); });
  await page.addInitScript(() => {
    const state = { contexts: 0, recorders: 0 };
    Object.assign(window, { aiCaptureProbe: state });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      constructor() { state.contexts++; throw new Error('AI AudioContext must not be created'); }
    } });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: class {
      static isTypeSupported() { return true; }
      constructor() { state.recorders++; throw new Error('AI recorder must not be created'); }
    } });
  });
  await page.route('**/ai-disabled-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/ai-disabled-harness.tsx');
  </script>` }));
  await page.goto('/ai-disabled-harness');
  await expect(page.getByText('Participant mounted')).toBeVisible();
  await page.getByRole('button', { name: 'Enter as host' }).click();
  await expect(page.getByText('Host mounted')).toBeVisible();
  await page.getByRole('button', { name: 'Exercise legacy resume' }).click();
  await page.getByRole('button', { name: 'Enter as participant' }).click();
  await expect(page.getByText('Participant mounted')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Finished without speech')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { aiCaptureProbe: object }).aiCaptureProbe)).toEqual({ contexts: 0, recorders: 0 });
  expect(audioRequests).toEqual([]);
});
