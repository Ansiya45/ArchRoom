import { test, expect } from '@playwright/test';

test('backup persists ordered chunks across reload and labels interrupted data partial', async ({ page }) => {
  await page.goto('/e2e/fixtures/recording-backup.html');
  await page.evaluate(async () => {
    const { RecordingBackupWriter } = await import(String('/src/lib/recordingBackup.ts'));
    const writer = await RecordingBackupWriter.create({ id: 'recording-1', ownerId: 'host', meetingCode: 'YLM-TEST',
      meetingName: 'Test meeting', fileName: 'meeting.webm', mimeType: 'video/webm', startedAt: new Date().toISOString() }, () => {});
    writer.append(new Blob(['first'])); writer.append(new Blob(['second']));
  });
  // Wait for committed IndexedDB writes before simulating interruption.
  await expect.poll(() => page.evaluate(async () => (await (await import(String('/src/lib/recordingBackup.ts'))).listRecordingBackups('host'))[0]?.count)).toBe(2);
  await page.reload();
  const result = await page.evaluate(async () => {
    const { reconstructRecordingBackup, listRecordingBackups } = await import(String('/src/lib/recordingBackup.ts'));
    const item = await reconstructRecordingBackup('host', 'recording-1');
    let denied = false;
    try { await reconstructRecordingBackup('other', 'recording-1'); } catch { denied = true; }
    return { bytes: await item.blob.text(), partial: item.partial, count: item.metadata.count, denied, other: (await listRecordingBackups('other')).length };
  });
  expect(result).toEqual({ bytes: 'firstsecond', partial: true, count: 2, denied: true, other: 0 });
});

test('completed backup detects a missing committed chunk', async ({ page }) => {
  await page.goto('/e2e/fixtures/recording-backup.html');
  const result = await page.evaluate(async () => {
    const { RecordingBackupWriter, reconstructRecordingBackup } = await import(String('/src/lib/recordingBackup.ts'));
    const writer = await RecordingBackupWriter.create({ id: 'complete', ownerId: 'host', meetingCode: 'YLM-TEST',
      meetingName: 'Test', fileName: 'meeting.webm', mimeType: 'video/webm', startedAt: new Date().toISOString() }, () => {});
    writer.append(new Blob(['one'])); writer.append(new Blob(['two']));
    const finished = await writer.finish(4);
    const backup = await reconstructRecordingBackup('host', 'complete');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ylaam-recording-backups-v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite'); tx.objectStore('chunks').delete(['complete', 0]);
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
    let damaged = false;
    try { await reconstructRecordingBackup('host', 'complete'); } catch { damaged = true; }
    return { finished, partial: backup.partial, bytes: await backup.blob.text(), damaged };
  });
  expect(result).toEqual({ finished: true, partial: false, bytes: 'onetwo', damaged: true });
});
