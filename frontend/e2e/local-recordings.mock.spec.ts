import { test, expect, login } from './fixtures/auth-mock';

async function mockRecordingApis(page: import('@playwright/test').Page) {
  for (const [path, data] of [
    ['meetings.history', []],
    ['recordings.getForMeeting', { recordings: [] }],
    ['recordings.createUpload', { recording: { id: '11111111-1111-4111-8111-111111111111' }, uploadUrl: '/synthetic-recording-upload' }],
    ['recordings.complete', { ok: true }],
  ] as const) {
    await page.route(`**/api/${path}*`, route => {
      const result = { result: { data } };
      return route.fulfill({ json: new URL(route.request().url()).searchParams.get('batch') === '1' ? [result] : result });
    });
  }
  await page.route('**/synthetic-recording-upload', route => route.fulfill({ status: 200, body: '' }));
}

test('encrypted chunks survive refresh and reopen, reject wrong passphrases, and delete explicitly', async ({ page, authMock }) => {
  await mockRecordingApis(page);
  await login(page, authMock);
  const ids = await page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts';
    const store = await import(/* @vite-ignore */ path);
    const details = { meetingCode: 'YLM-ABC234', occurrenceId: '22222222-2222-4222-8222-222222222222', fileName: 'private-recording.mp4', mimeType: 'video/mp4', durationSeconds: 3 };
    for (const text of ['first secret', 'second secret']) {
      const writer = await store.LocalRecordingWriter.create(owner, 'recovery-passphrase', details, () => {});
      writer.append(new Blob([text.slice(0, 5)])); writer.append(new Blob([text.slice(5)]));
      if (!await writer.finish(details)) throw new Error('Local save failed');
    }
    const rows = await store.listLocalRecordings(owner);
    const request = indexedDB.open('ylaam-local-recordings');
    const db: IDBDatabase = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('chunks', 'readonly'), chunks = tx.objectStore('chunks').getAll();
    const raw: Array<{ data: ArrayBuffer }> = await new Promise((resolve, reject) => { chunks.onsuccess = () => resolve(chunks.result); chunks.onerror = () => reject(chunks.error); });
    db.close();
    if (raw.some(chunk => new TextDecoder().decode(chunk.data).includes('secret'))) throw new Error('Chunk was not encrypted');
    if (rows.length !== 2 || rows.some((row: { state: string; count: number }) => row.state !== 'complete' || row.count !== 2)) throw new Error('Invalid manifests');
    return rows.map((row: { id: string }) => row.id);
  }, authMock.user.id);
  expect(new Set(ids).size).toBe(2);
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Unlock', exact: true }).first().click();
  await page.getByLabel('Recovery passphrase').fill('incorrect');
  await page.getByRole('button', { name: 'Review recording' }).click();
  await expect(page.getByText('Incorrect recovery passphrase or damaged recording.')).toBeVisible();
  await page.getByLabel('Recovery passphrase').fill('recovery-passphrase');
  await page.getByRole('button', { name: 'Review recording' }).click();
  const dialog = page.getByRole('dialog', { name: 'Host recordings' });
  await expect(dialog.getByRole('button', { name: 'Download to computer' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload to Supabase' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload to Google Drive' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload to Supabase' }).click();
  await expect(dialog.getByRole('button', { name: 'Uploaded to Supabase' })).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download to computer' }).click();
  expect((await download).suggestedFilename()).toBe('private-recording.mp4');
  await dialog.getByRole('button', { name: 'Close recordings' }).click();
  page.once('dialog', prompt => prompt.dismiss());
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(2);
  page.once('dialog', prompt => prompt.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await mockRecordingApis(reopened);
  await reopened.goto('/');
  await reopened.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await reopened.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await expect(reopened.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);
});

test('recorder persists encrypted chunks progressively before stop and recovers after reopening', async ({ page }) => {
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.goto('/recording-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'synthetic'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'test-recording-owner' })); });
  await page.getByRole('button', { name: 'Enable test recovery' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText('Encrypted local recovery is active.')).toBeVisible();
  const getRows = () => page.evaluate(async () => { const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path); return store.listLocalRecordings('test-recording-owner'); });
  await expect.poll(async () => (await getRows())[0]?.count).toBeGreaterThan(0);
  expect((await getRows())[0].state).toBe('recording');
  await page.getByRole('button', { name: 'Stop twice' }).click();
  await expect(page.getByText('Encrypted recording saved on this device.')).toBeVisible();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  const recovered = await page.evaluate(async () => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const [entry] = await store.listLocalRecordings('test-recording-owner');
    const result = await store.unlockLocalRecording('test-recording-owner', entry.id, 'test-recovery-passphrase');
    return { state: entry.state, count: entry.count, size: result.blob.size, meetingCode: result.details.meetingCode };
  });
  expect(recovered.state).toBe('complete'); expect(recovered.count).toBeGreaterThan(0); expect(recovered.size).toBeGreaterThan(0); expect(recovered.meetingCode).toBe('YLM-ABC234');
});

test('unavailable IndexedDB preserves the recorder preview', async ({ page }) => {
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.goto('/recording-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'synthetic'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'test-recording-owner' })); Object.defineProperty(indexedDB, 'open', { value: () => { throw new DOMException('Blocked', 'SecurityError'); } }); });
  await page.getByRole('button', { name: 'Enable test recovery' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText(/Local recovery is unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop twice' }).click();
  await expect(page.getByTestId('preview')).toHaveText('Ready');
});

test('a recorder start failure locks the prepared recovery entry', async ({ page }) => {
  await page.addInitScript(() => {
    class FailingRecorder {
      static isTypeSupported() { return true; }
      mimeType = 'video/mp4'; state = 'inactive';
      start() { throw new Error('Recorder could not start'); }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: FailingRecorder });
  });
  await page.route('**/recording-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-harness.tsx');</script>` }));
  await page.goto('/recording-harness');
  await page.evaluate(() => { localStorage.setItem('ylaam_meet_token', 'synthetic'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'test-recording-owner' })); });
  await page.getByRole('button', { name: 'Enable test recovery' }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Recorder could not start');
  await expect(page.getByText('Local recovery stopped because the recording could not start.')).toBeVisible();
  await expect(page.getByTestId('preview')).toHaveCount(0);
});

test('interrupted and quota-failed writes retain committed chunks without claiming completion', async ({ page, authMock }) => {
  await login(page, authMock);
  const result = await page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts';
    const store = await import(/* @vite-ignore */ path);
    const details = { meetingCode: 'YLM-ABC234', fileName: 'partial.webm', mimeType: 'video/webm', durationSeconds: 0 };
    const writer = await store.LocalRecordingWriter.create(owner, 'partial-passphrase', details, () => {});
    writer.append(new Blob(['first']));
    // Wait until the first transaction commits, then simulate a later quota failure.
    for (let i = 0; i < 100; i++) { if ((await store.listLocalRecordings(owner))[0].count === 1) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) { if (this.name === 'chunks') throw new DOMException('Full', 'QuotaExceededError'); return original.apply(this, args); };
    writer.append(new Blob(['second']));
    const saved = await writer.finish(details);
    IDBObjectStore.prototype.add = original;
    const [entry] = await store.listLocalRecordings(owner);
    const recovered = await store.unlockLocalRecording(owner, entry.id, 'partial-passphrase');
    return { saved, state: entry.state, count: entry.count, data: await recovered.blob.text() };
  }, authMock.user.id);
  expect(result).toEqual({ saved: false, state: 'storage-failed', count: 1, data: 'first' });
});

test('incomplete recordings are offered only for best-effort download and corruption is detected', async ({ page, authMock }) => {
  await mockRecordingApis(page);
  await login(page, authMock);
  const id = await page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const details = { meetingCode: 'YLM-ABC234', fileName: 'partial.webm', mimeType: 'video/webm', durationSeconds: 0 };
    const writer = await store.LocalRecordingWriter.create(owner, 'partial-passphrase', details, () => {});
    writer.append(new Blob(['partial']));
    for (let i = 0; i < 100; i++) { const rows = await store.listLocalRecordings(owner); if (rows[0].count === 1) { writer.lock(); return rows[0].id; } await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('Chunk did not commit');
  }, authMock.user.id);
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByLabel('Recovery passphrase').fill('partial-passphrase');
  await page.getByRole('button', { name: 'Review recording' }).click();
  const dialog = page.getByRole('dialog', { name: 'Host recordings' });
  await expect(dialog.getByText(/incomplete recording may not play/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download to computer' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload to Supabase' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close recordings' }).click();
  const result = await page.evaluate(async ({ owner, id }) => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const db: IDBDatabase = await new Promise((resolve, reject) => { const request = indexedDB.open('ylaam-local-recordings'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite'), chunks = tx.objectStore('chunks'), request = chunks.get([id, 0]);
      request.onsuccess = () => { const row = request.result; new Uint8Array(row.data)[0] ^= 1; chunks.put(row); };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
    try { await store.unlockLocalRecording(owner, id, 'partial-passphrase'); return { rejected: false, remaining: 0 }; }
    catch { return { rejected: true, remaining: (await store.listLocalRecordings(owner)).length }; }
  }, { owner: authMock.user.id, id });
  expect(result).toEqual({ rejected: true, remaining: 1 });
});

test('account change hides and locks an unlocked local recording', async ({ page, authMock }) => {
  await mockRecordingApis(page);
  await login(page, authMock);
  const ownerBindingProtected = await page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts';
    const store = await import(/* @vite-ignore */ path);
    const details = { meetingCode: 'YLM-ABC234', fileName: 'private.mp4', mimeType: 'video/mp4', durationSeconds: 1 };
    const writer = await store.LocalRecordingWriter.create(owner, 'private-passphrase', details, () => {});
    writer.append(new Blob(['private'])); await writer.finish(details);
    const [entry] = await store.listLocalRecordings(owner);
    const db: IDBDatabase = await new Promise((resolve, reject) => { const request = indexedDB.open('ylaam-local-recordings'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const changeOwner = (ownerId: string) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite'), records = tx.objectStore('recordings'), request = records.get(entry.id);
      request.onsuccess = () => { records.put({ ...request.result, ownerId }); };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    await changeOwner('different-account');
    let rejected = false;
    try { await store.unlockLocalRecording('different-account', entry.id, 'private-passphrase'); } catch { rejected = true; }
    await changeOwner(owner); db.close();
    return rejected;
  }, authMock.user.id);
  expect(ownerBindingProtected).toBe(true);
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByLabel('Recovery passphrase').fill('private-passphrase');
  await page.getByRole('button', { name: 'Review recording' }).click();
  await expect(page.getByRole('dialog', { name: 'Host recordings' })).toBeVisible();
  await page.evaluate(() => { const user = JSON.parse(localStorage.getItem('ylaam_meet_user')!); user.id = 'different-account'; localStorage.setItem('ylaam_meet_user', JSON.stringify(user)); });
  await expect(page.getByRole('dialog', { name: 'Host recordings' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
});

test('an invalidated session closes the recovery list before another unlock', async ({ page, authMock }) => {
  await mockRecordingApis(page);
  await login(page, authMock);
  await page.evaluate(async owner => {
    const path = '/src/lib/localRecordingStore.ts'; const store = await import(/* @vite-ignore */ path);
    const details = { meetingCode: 'YLM-ABC234', fileName: 'private.mp4', mimeType: 'video/mp4', durationSeconds: 1 };
    const writer = await store.LocalRecordingWriter.create(owner, 'private-passphrase', details, () => {});
    writer.append(new Blob(['private'])); await writer.finish(details);
  }, authMock.user.id);
  await page.getByRole('complementary').getByRole('button', { name: 'Meeting History' }).click();
  await page.getByRole('button', { name: 'Local Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByLabel('Recovery passphrase').fill('private-passphrase');
  authMock.expired = true;
  await page.getByRole('button', { name: 'Review recording' }).click();
  await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Host recordings' })).toBeHidden();
});
