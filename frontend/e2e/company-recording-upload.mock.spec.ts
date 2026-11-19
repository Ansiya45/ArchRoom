import { test, expect, type Page } from '@playwright/test';

async function openHarness(page: Page) {
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.addInitScript(() => {
    class Recorder {
      static isTypeSupported(type: string) { return type.startsWith('video/webm'); }
      state = 'inactive'; mimeType = 'video/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob(['original-'], { type: this.mimeType }) }); }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['bytes'], { type: this.mimeType }) }); this.onstop?.(); }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
  });
  await page.goto('/recording-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'synthetic'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'test-recording-owner' })); });
}

test('manual stop stages canonical bytes, retries a failed chunk, and waits for backend completion', async ({ page }) => {
  let available = true, offset = 0, verified = false, failedChunk = false, requested = false, completed = false;
  let recordingId = '', jobCreates = 0, chunkBody = '';
  const jobId = '00000000-0000-4000-8000-000000000001';
  const progress = () => ({ jobId, recordingId, mimeType: 'video/webm', byteLength: 14, ingestionOffset: offset, ingestionState: verified ? 'verified' : 'unverified' });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/recording-staging/')) {
      if (url.pathname.endsWith('/chunks')) {
        if (!failedChunk) { failedChunk = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); return; }
        chunkBody = route.request().postDataBuffer()?.toString() ?? ''; offset = Buffer.byteLength(chunkBody);
      }
      if (url.pathname.endsWith('/verify')) verified = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(progress()) }); return;
    }
    const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
    const results = paths.map((path, index) => {
      const value = url.searchParams.get('batch') === '1' ? input?.[index] : input;
      if (path === 'auth.me') return { result: { data: { user: { id: 'test-recording-owner' } } } };
      if (path === 'recordings.companyUploadCapability') return { result: { data: { available } } };
      if (path === 'recordings.createCompanyJob') { jobCreates++; recordingId = value.recordingId; return { result: { data: { id: jobId, recordingId } } }; }
      if (path === 'recordings.getForMeeting') return { result: { data: { recordings: [] } } };
      if (path === 'recordings.requestCompanyJobProcessing') { requested = true; return { result: { data: { accepted: true } } }; }
      if (path === 'recordings.companyJobProgress') return { result: { data: { jobId, recordingId, stage: completed ? 'completed' : requested ? 'uploading_to_drive' : 'preparing_drive_upload', stagedBytes: offset, expectedBytes: 14, driveConfirmedBytes: completed ? 14 : 0, errorCode: null } } };
      throw new Error(`Unexpected mock API: ${path}`);
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
  });
  await openHarness(page);
  await page.getByRole('button', { name: 'Enable test recovery' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop and upload to company' }).click();
  await expect(page.getByText('Upload interrupted. Keep the recording and retry.')).toBeVisible();
  expect(requested).toBe(false);
  const originalId = recordingId;
  await page.getByRole('button', { name: 'Retry upload' }).click();
  await expect(page.getByText('Uploading to company Drive')).toBeVisible();
  expect(chunkBody).toBe('original-bytes'); expect(recordingId).toBe(originalId); expect(jobCreates).toBe(2);
  expect(requested).toBe(true); expect(verified).toBe(true);
  await expect(page.getByText('Saved to company Drive and available in Meeting History')).toHaveCount(0);
  completed = true;
  await expect(page.getByText('Saved to company Drive and available in Meeting History')).toBeVisible({ timeout: 6000 });
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByLabel('Recovery passphrase').fill('test-recovery-passphrase');
  await page.getByRole('button', { name: 'Review recording' }).click();
  await page.getByRole('button', { name: 'Resume company upload' }).click();
  await expect.poll(() => jobCreates).toBe(3);
  expect(recordingId).toBe(originalId);
  await expect(page.getByText('Saved to company Drive and available in Meeting History')).toBeVisible();
  available = false;
});

test('disabled capability keeps the manual recording workflow and creates no job', async ({ page }) => {
  let jobs = 0, checks = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
    const results = paths.map(path => {
      if (path === 'auth.me') return { result: { data: { user: { id: 'test-recording-owner' } } } };
      if (path === 'recordings.companyUploadCapability') { checks++; return { result: { data: { available: false } } }; }
      if (path === 'recordings.createCompanyJob') jobs++;
      throw new Error(`Unexpected mock API: ${path}`);
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
  });
  await openHarness(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.getByRole('button', { name: 'Stop and upload to company' }).click();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  await expect.poll(() => checks).toBe(1);
  expect(jobs).toBe(0);
  await expect(page.getByLabel('Company recording uploads')).toContainText('Company Drive upload is unavailable. Download or save this recording locally.');
});

test('manual reconciliation is displayed without a retry or processing request', async ({ page }) => {
  let recordingId = '', offset = 0, verified = false, requests = 0;
  const jobId = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/recording-staging/')) {
      if (url.pathname.endsWith('/chunks')) offset = route.request().postDataBuffer()?.length ?? 0;
      if (url.pathname.endsWith('/verify')) verified = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobId, recordingId, mimeType: 'video/webm', byteLength: 14, ingestionOffset: offset, ingestionState: verified ? 'verified' : 'unverified' }) }); return;
    }
    const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
    const results = paths.map((path, index) => {
      const value = url.searchParams.get('batch') === '1' ? input?.[index] : input;
      if (path === 'auth.me') return { result: { data: { user: { id: 'test-recording-owner' } } } };
      if (path === 'recordings.companyUploadCapability') return { result: { data: { available: true } } };
      if (path === 'recordings.createCompanyJob') { recordingId = value.recordingId; return { result: { data: { id: jobId, recordingId } } }; }
      if (path === 'recordings.companyJobProgress') return { result: { data: { jobId, recordingId, stage: 'manual_reconciliation', stagedBytes: offset, expectedBytes: 14, driveConfirmedBytes: 0, errorCode: null } } };
      if (path === 'recordings.requestCompanyJobProcessing' || path === 'recordings.retryCompanyJob') requests++;
      throw new Error(`Unexpected mock API: ${path}`);
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
  });
  await openHarness(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop and upload to company' }).click();
  await expect(page.getByText('Upload needs manual reconciliation. Keep your recording.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry upload' })).toHaveCount(0);
  expect(requests).toBe(0);
});

test('backend retryable failures wait for an explicit retry', async ({ page }) => {
  let recordingId = '', offset = 0, verified = false, retryCalls = 0;
  let stage = 'retryable_failure';
  const jobId = '00000000-0000-4000-8000-000000000001';
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/recording-staging/')) {
      if (url.pathname.endsWith('/chunks')) offset = route.request().postDataBuffer()?.length ?? 0;
      if (url.pathname.endsWith('/verify')) verified = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobId, recordingId, mimeType: 'video/webm', byteLength: 14, ingestionOffset: offset, ingestionState: verified ? 'verified' : 'unverified' }) }); return;
    }
    const paths = decodeURIComponent(url.pathname.slice('/api/'.length)).split(',');
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}');
    const results = paths.map((path, index) => {
      const value = url.searchParams.get('batch') === '1' ? input?.[index] : input;
      if (path === 'auth.me') return { result: { data: { user: { id: 'test-recording-owner' } } } };
      if (path === 'recordings.companyUploadCapability') return { result: { data: { available: true } } };
      if (path === 'recordings.createCompanyJob') { recordingId = value.recordingId; return { result: { data: { id: jobId, recordingId } } }; }
      if (path === 'recordings.companyJobProgress') return { result: { data: { jobId, recordingId, stage, stagedBytes: offset, expectedBytes: 14, driveConfirmedBytes: 0, errorCode: null } } };
      if (path === 'recordings.retryCompanyJob') { retryCalls++; stage = 'completed'; return { result: { data: { accepted: true } } }; }
      throw new Error(`Unexpected mock API: ${path}`);
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
  });
  await openHarness(page);
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop and upload to company' }).click();
  await expect(page.getByText('Upload interrupted. Keep the recording and retry.')).toBeVisible();
  expect(retryCalls).toBe(0);
  await page.getByRole('button', { name: 'Retry upload' }).click();
  await expect(page.getByText('Saved to company Drive and available in Meeting History')).toBeVisible();
  expect(retryCalls).toBe(1);
});
