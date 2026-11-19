import { test, expect } from '@playwright/test';

async function openHarness(page: import('@playwright/test').Page) {
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.goto('/recording-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'synthetic'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'test-recording-owner' })); });
}

test('separate recording cycles receive distinct stable identities', async ({ page }) => {
  await openHarness(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  const first = await page.evaluate(() => (window as any).latestRecordingPreview.recordingId as string);
  await page.getByRole('button', { name: 'Discard preview' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  const second = await page.evaluate(() => (window as any).latestRecordingPreview.recordingId as string);
  expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  expect(second).toMatch(/^[0-9a-f-]{36}$/i);
  expect(second).not.toBe(first);
});

for (const mime of ['video/webm', 'video/mp4'] as const) {
  test(`canonical ${mime} bytes match initial and recovered recording across refresh`, async ({ page }) => {
    await page.addInitScript(mime => {
      class Recorder {
        static isTypeSupported(type: string) { return type.startsWith(mime); }
        state = 'inactive'; mimeType = mime;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob(['first-part'], { type: mime }) }); }
        pause() { this.state = 'paused'; }
        resume() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['last-part'], { type: mime }) }); this.onstop?.(); }
      }
      Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
    }, mime);
    await openHarness(page);
    await page.getByRole('button', { name: 'Enable test recovery' }).click();
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop twice' }).click();
    await expect(page.getByText('Encrypted recording saved on this device.')).toBeVisible();
    await expect(page.getByTestId('preview')).toHaveText('Ready');
    const initial = await page.evaluate(async () => {
      const preview = (window as any).latestRecordingPreview;
      const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
      const first = preview.canonicalBlob as Blob;
      return { hash: await digest(first), retryHash: await digest(preview.canonicalBlob), size: first.size, mime: first.type, text: await first.text(), recordingId: preview.recordingId };
    });
    expect(initial.text).toBe('first-partlast-part');
    expect(initial.hash).toEqual(initial.retryHash); expect(initial.mime).toBe(mime);
    page.once('dialog', dialog => dialog.accept()); await page.reload();
    const recovered = await page.evaluate(async () => {
      const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
      const [entry] = await store.listLocalRecordings('test-recording-owner');
      const result = await store.unlockLocalRecording('test-recording-owner', entry.id, 'test-recovery-passphrase');
      return { hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer()))), size: result.blob.size, mime: result.blob.type, state: result.record.state, recordingId: result.details.uploadRecordingId };
    });
    expect(initial.recordingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(recovered).toEqual({ hash: initial.hash, size: initial.size, mime, state: 'complete', recordingId: initial.recordingId });
  });
}

test('legacy encrypted chunks remain canonical even when preview repair changes bytes', async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate(async () => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const encodingPath = '/src/lib/recordingEncoding.ts'; const encoding = await import(/* @vite-ignore */ encodingPath);
    const details = { meetingCode: 'YLM-ABC234', fileName: 'legacy.webm', mimeType: 'video/webm', durationSeconds: 2 };
    const writer = await store.LocalRecordingWriter.create('test-recording-owner', 'legacy-passphrase', details, () => {});
    writer.append(new Blob(['original-one'])); writer.append(new Blob(['original-two']));
    if (!await writer.finish(details)) throw new Error('save failed');
    const [entry] = await store.listLocalRecordings('test-recording-owner');
    const first = await store.unlockLocalRecording('test-recording-owner', entry.id, 'legacy-passphrase');
    const repaired = await encoding.repairWebmBlob(first.blob, 2000, async (blob: Blob) => new Blob(['repaired:', blob], { type: 'video/webm' }));
    const retry = await store.unlockLocalRecording('test-recording-owner', entry.id, 'legacy-passphrase');
    return { canonical: await first.blob.text(), retry: await retry.blob.text(), preview: await repaired.text(), state: first.record.state, mime: first.blob.type, size: first.blob.size,
      legacyEligible: Boolean(store.canonicalRecoveredBlob(first.record, first.details, first.blob)),
      incompleteEligible: Boolean(store.canonicalRecoveredBlob({ ...first.record, state: 'storage-failed' }, first.details, first.blob)),
      failedRecorderEligible: Boolean(store.canonicalRecoveredBlob(first.record, { ...first.details, canonicalEligible: false }, first.blob)) };
  });
  expect(result).toEqual({ canonical: 'original-oneoriginal-two', retry: 'original-oneoriginal-two', preview: 'repaired:original-oneoriginal-two', state: 'complete', mime: 'video/webm', size: 24, legacyEligible: true, incompleteEligible: false, failedRecorderEligible: false });
});

test('real WebM repair preserves original bytes for recovery', async ({ page }) => {
  await page.addInitScript(() => {
    const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
    Object.defineProperty(MediaRecorder, 'isTypeSupported', { value: (mime: string) => mime.startsWith('video/webm') && supported(mime) });
  });
  await openHarness(page);
  await page.getByRole('button', { name: 'Enable test recovery' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    return (await store.listLocalRecordings('test-recording-owner'))[0]?.count ?? 0;
  })).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByText('Encrypted recording saved on this device.')).toBeVisible();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  const initial = await page.evaluate(async () => {
    const preview = (window as any).latestRecordingPreview;
    const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
    return { raw: await hash(preview.canonicalBlob), preview: await hash(preview.blob), size: preview.canonicalBlob.size, mime: preview.canonicalBlob.type };
  });
  expect(initial.mime).toBe('video/webm');
  expect(initial.preview).not.toEqual(initial.raw);
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  const recovered = await page.evaluate(async () => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const [entry] = await store.listLocalRecordings('test-recording-owner');
    const result = await store.unlockLocalRecording('test-recording-owner', entry.id, 'test-recovery-passphrase');
    return { hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer()))), size: result.blob.size, mime: result.blob.type };
  });
  expect(recovered).toEqual({ hash: initial.raw, size: initial.size, mime: initial.mime });
});
