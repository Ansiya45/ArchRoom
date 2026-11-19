// Unencrypted browser-local emergency backup. Browser storage is best-effort.
export type BackupMetadata = {
  id: string; ownerId: string; meetingCode: string; meetingName: string; meetingId?: string;
  occurrenceId?: string; fileName: string; mimeType: string; startedAt: string;
  state: 'recording' | 'complete' | 'storage-failed'; count: number; bytes: number;
  durationSeconds: number;
  uploadIntent?: { destinationFolderId: string | null };
};
type BackupChunk = { recordingId: string; index: number; blob: Blob };
const databaseName = 'ylaam-recording-backups-v1';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    const timer = setTimeout(() => { settled = true; reject(new Error('Browser backup is unavailable.')); }, 5000);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('recordings', { keyPath: 'id' }).createIndex('owner', 'ownerId');
      request.result.createObjectStore('chunks', { keyPath: ['recordingId', 'index'] });
    };
    request.onerror = () => { clearTimeout(timer); if (!settled) { settled = true; reject(request.error ?? new Error('Browser backup is unavailable.')); } };
    request.onblocked = () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('Browser backup is blocked by another tab.')); } };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true; request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Browser backup transaction failed.'));
    tx.onerror = () => {};
  });
}
function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export class RecordingBackupWriter {
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private count = 0;
  private bytes = 0;
  private constructor(private readonly meta: BackupMetadata, private readonly onFailure: () => void) {}

  static async create(meta: Omit<BackupMetadata, 'state' | 'count' | 'bytes' | 'durationSeconds'>, onFailure: () => void) {
    if (!meta.id || !meta.ownerId || !meta.meetingCode) throw new Error('Backup identity is unavailable.');
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
    const row: BackupMetadata = { ...meta, state: 'recording', count: 0, bytes: 0, durationSeconds: 0 };
    const db = await open();
    try { const tx = db.transaction('recordings', 'readwrite'); tx.objectStore('recordings').add(row); await complete(tx); }
    finally { db.close(); }
    return new RecordingBackupWriter(row, onFailure);
  }

  append(blob: Blob) {
    if (!blob.size || this.failed) return;
    const index = this.count++;
    this.bytes += blob.size;
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      const db = await open();
      try {
        const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
        const records = tx.objectStore('recordings');
        const request = records.get(this.meta.id);
        request.onsuccess = () => {
          const row = request.result as BackupMetadata | undefined;
          if (!row || row.ownerId !== this.meta.ownerId || row.state !== 'recording' || row.count !== index) { tx.abort(); return; }
          tx.objectStore('chunks').add({ recordingId: row.id, index, blob } satisfies BackupChunk);
          records.put({ ...row, count: index + 1, bytes: row.bytes + blob.size });
        };
        await complete(tx);
      } finally { db.close(); }
    }).catch(() => { if (!this.failed) { this.failed = true; this.onFailure(); } });
  }

  async finish(durationSeconds: number): Promise<boolean> {
    await this.queue;
    if (this.failed || !this.count) return false;
    const db = await open();
    try {
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
      const request = store.get(this.meta.id);
      request.onsuccess = () => {
        const row = request.result as BackupMetadata | undefined;
        if (!row || row.ownerId !== this.meta.ownerId || row.state !== 'recording' || row.count !== this.count || row.bytes !== this.bytes) { tx.abort(); return; }
        store.put({ ...row, state: 'complete', durationSeconds });
      };
      await complete(tx); return true;
    } catch { this.failed = true; this.onFailure(); return false; }
    finally { db.close(); }
  }
}

export async function listRecordingBackups(ownerId: string): Promise<BackupMetadata[]> {
  const db = await open();
  try { const tx = db.transaction('recordings', 'readonly'); return (await read(tx.objectStore('recordings').index('owner').getAll(ownerId))).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  finally { db.close(); }
}

export async function reconstructRecordingBackup(ownerId: string, id: string) {
  const db = await open();
  try {
    const tx = db.transaction(['recordings', 'chunks'], 'readonly');
    const row = await read(tx.objectStore('recordings').get(id)) as BackupMetadata | undefined;
    if (!row || row.ownerId !== ownerId) throw new Error('Browser backup is unavailable.');
    const chunks = await read(tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))) as BackupChunk[];
    if (!row.count || chunks.length !== row.count || chunks.some((chunk, index) => chunk.recordingId !== id || chunk.index !== index) || chunks.reduce((sum, chunk) => sum + chunk.blob.size, 0) !== row.bytes)
      throw new Error('Browser backup has missing or damaged chunks.');
    return { metadata: row, blob: new Blob(chunks.map(chunk => chunk.blob), { type: row.mimeType }), partial: row.state !== 'complete' };
  } finally { db.close(); }
}

// A destination is frozen at the first upload attempt; a recording job cannot
// safely be retargeted after an uncertain acknowledgement.
export async function recordBackupUploadIntent(ownerId: string, id: string, destinationFolderId: string | null): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction('recordings', 'readwrite'), store = tx.objectStore('recordings'), request = store.get(id);
    request.onsuccess = () => {
      const row = request.result as BackupMetadata | undefined;
      if (!row) return; // Backups may be unavailable; normal uploads still work.
      if (row.ownerId !== ownerId || row.state !== 'complete' || (row.uploadIntent && row.uploadIntent.destinationFolderId !== destinationFolderId)) { tx.abort(); return; }
      store.put({ ...row, uploadIntent: { destinationFolderId } });
    };
    await complete(tx);
  } finally { db.close(); }
}

// Called only after the caller has authenticated and verified the exact bytes.
export async function deleteConfirmedBackup(expected: BackupMetadata, accountStillMatches: () => boolean): Promise<boolean> {
  const db = await open();
  try {
    let deleted = false;
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite'), store = tx.objectStore('recordings'), request = store.get(expected.id);
    request.onsuccess = () => {
      const row = request.result as BackupMetadata | undefined;
      if (!row) return;
      if (!accountStillMatches() || row.ownerId !== expected.ownerId || row.state !== 'complete' || row.meetingId !== expected.meetingId ||
          row.meetingCode !== expected.meetingCode || row.occurrenceId !== expected.occurrenceId || row.count !== expected.count ||
          row.bytes !== expected.bytes || row.mimeType !== expected.mimeType || !row.uploadIntent ||
          row.uploadIntent.destinationFolderId !== expected.uploadIntent?.destinationFolderId) { tx.abort(); return; }
      store.delete(row.id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound([row.id, 0], [row.id, Number.MAX_SAFE_INTEGER]));
      deleted = true;
    };
    await complete(tx); return deleted;
  } finally { db.close(); }
}
