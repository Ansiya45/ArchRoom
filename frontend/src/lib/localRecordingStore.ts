// Browser-local encrypted recording storage. No passphrases or keys are persisted.
export type LocalRecordingState = 'recording' | 'complete' | 'storage-failed';
export type RecordingDetails = { meetingCode: string; occurrenceId?: string; fileName: string; mimeType: string; durationSeconds: number; canonicalEligible?: boolean; uploadRecordingId?: string; recordingStartedAt?: string };
export type LocalRecording = { id: string; ownerId: string; createdAt: number; state: LocalRecordingState; count: number; bytes: number; salt: Uint8Array; checkIv: Uint8Array; check: ArrayBuffer; detailsIv: Uint8Array; details: ArrayBuffer };
// Legacy entries have no eligibility marker; incomplete states are never canonical.
export function canonicalRecoveredBlob(record: LocalRecording, details: RecordingDetails, blob: Blob): Blob | null {
  return record.state === 'complete' && details.canonicalEligible !== false && blob.size > 0 ? blob : null;
}
type Chunk = { recordingId: string; index: number; iv: Uint8Array; bytes: number; data: ArrayBuffer };
const databaseName = 'ylaam-local-recordings';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const iterations = 310_000;
const context = (ownerId: string, id: string, item: string) => JSON.stringify(['ylaam-local-recording-v1', ownerId, id, item]);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(databaseName, 1);
    const timer = setTimeout(() => { settled = true; reject(new Error('Local recording storage is unavailable.')); }, 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('owner', 'ownerId');
      db.createObjectStore('chunks', { keyPath: ['recordingId', 'index'] });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timer); if (!settled) reject(request.error); };
    request.onblocked = () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('Close other tabs to use local recording storage.')); } };
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Local recording transaction failed.')); tx.onerror = () => {}; });
}
function value<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function random(size: number) { return crypto.getRandomValues(new Uint8Array(size)); }
async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(key: CryptoKey, data: BufferSource, context: string) {
  const iv = random(12);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, data);
  return { iv, encrypted };
}
function decrypt(key: CryptoKey, iv: Uint8Array, data: ArrayBuffer, context: string) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, data);
}

export class LocalRecordingWriter {
  private key: CryptoKey | null;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private count = 0;
  private bytes = 0;
  private constructor(private record: LocalRecording, key: CryptoKey, private onFailure: () => void) { this.key = key; }

  static async create(ownerId: string, passphrase: string, details: RecordingDetails, onFailure: () => void) {
    if (!ownerId || passphrase.length < 12) throw new Error('A signed-in account and a recovery passphrase of at least 12 characters are required.');
    const id = crypto.randomUUID(), salt = random(16), key = await derive(passphrase, salt);
    const check = await encrypt(key, encoder.encode('ylaam-local-recording-v1'), context(ownerId, id, 'check'));
    const metadata = await encrypt(key, encoder.encode(JSON.stringify(details)), context(ownerId, id, 'details'));
    const record: LocalRecording = { id, ownerId, createdAt: Date.now(), state: 'recording', count: 0, bytes: 0, salt, checkIv: check.iv, check: check.encrypted, detailsIv: metadata.iv, details: metadata.encrypted };
    const db = await openDatabase();
    try { const tx = db.transaction('recordings', 'readwrite'); tx.objectStore('recordings').add(record); await done(tx); }
    finally { db.close(); }
    return new LocalRecordingWriter(record, key, onFailure);
  }
  append(blob: Blob) {
    if (!blob.size || this.failed) return;
    const index = this.count++;
    this.bytes += blob.size;
    this.queue = this.queue.then(async () => {
      if (this.failed || !this.key) return;
      const encrypted = await encrypt(this.key, await blob.arrayBuffer(), context(this.record.ownerId, this.record.id, `chunk:${index}`));
      if (this.failed || !this.key) return;
      const db = await openDatabase();
      try {
        const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
        const records = tx.objectStore('recordings');
        const get = records.get(this.record.id);
        get.onsuccess = () => {
          const current = get.result as LocalRecording | undefined;
          if (!current || current.ownerId !== this.record.ownerId || current.count !== index || current.state !== 'recording') { tx.abort(); return; }
          tx.objectStore('chunks').add({ recordingId: this.record.id, index, iv: encrypted.iv, bytes: blob.size, data: encrypted.encrypted } satisfies Chunk);
          records.put({ ...current, count: index + 1, bytes: current.bytes + blob.size });
        };
        await done(tx);
      } finally { db.close(); }
    }).catch(() => { this.failed = true; this.onFailure(); });
  }
  async finish(details: RecordingDetails) {
    await this.queue;
    if (this.failed || !this.key || !this.count) { await this.markFailed(); return false; }
    try {
      const encrypted = await encrypt(this.key, encoder.encode(JSON.stringify(details)), context(this.record.ownerId, this.record.id, 'details'));
      if (this.failed || !this.key) return false;
      const db = await openDatabase();
      try {
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        const get = store.get(this.record.id);
        get.onsuccess = () => {
          const current = get.result as LocalRecording | undefined;
          if (this.failed || !this.key || !current || current.ownerId !== this.record.ownerId || current.count !== this.count || current.bytes !== this.bytes || current.state !== 'recording') { tx.abort(); return; }
          store.put({ ...current, state: 'complete', detailsIv: encrypted.iv, details: encrypted.encrypted });
        };
        await done(tx);
      } finally { db.close(); }
      this.key = null;
      return true;
    } catch { this.failed = true; this.onFailure(); await this.markFailed(); return false; }
  }
  lock() { this.failed = true; this.key = null; void this.markFailed(); }
  private async markFailed() {
    try {
      const db = await openDatabase();
      try {
        const tx = db.transaction('recordings', 'readwrite'), store = tx.objectStore('recordings'), get = store.get(this.record.id);
        get.onsuccess = () => { const row = get.result as LocalRecording | undefined; if (row && row.state === 'recording') store.put({ ...row, state: 'storage-failed' }); };
        await done(tx);
      } finally { db.close(); }
    } catch { /* Existing committed chunks remain marked incomplete. */ }
    this.key = null;
  }
}

export async function listLocalRecordings(ownerId: string): Promise<LocalRecording[]> {
  const db = await openDatabase();
  try { const tx = db.transaction('recordings', 'readonly'); return (await value(tx.objectStore('recordings').index('owner').getAll(ownerId))).sort((a, b) => b.createdAt - a.createdAt); }
  finally { db.close(); }
}
export async function unlockLocalRecording(ownerId: string, id: string, passphrase: string) {
  const db = await openDatabase();
  let record: LocalRecording, chunks: Chunk[];
  try {
    const tx = db.transaction(['recordings', 'chunks'], 'readonly');
    const row = await value(tx.objectStore('recordings').get(id)) as LocalRecording | undefined;
    if (!row || row.ownerId !== ownerId) throw new Error('Local recording is unavailable.');
    record = row;
    chunks = await value(tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))) as Chunk[];
  } finally { db.close(); }
  const key = await derive(passphrase, record.salt);
  try { if (decoder.decode(await decrypt(key, record.checkIv, record.check, context(ownerId, id, 'check'))) !== 'ylaam-local-recording-v1') throw new Error(); }
  catch { throw new Error('Incorrect recovery passphrase or damaged recording.'); }
  try {
    const details = JSON.parse(decoder.decode(await decrypt(key, record.detailsIv, record.details, context(ownerId, id, 'details')))) as RecordingDetails;
    if (!details.meetingCode || !details.fileName || !details.mimeType || chunks.length !== record.count || !chunks.length) throw new Error();
    let total = 0;
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.index !== i || chunk.recordingId !== id) throw new Error();
      const data = await decrypt(key, chunk.iv, chunk.data, context(ownerId, id, `chunk:${i}`));
      if (data.byteLength !== chunk.bytes) throw new Error();
      total += data.byteLength; parts.push(data);
    }
    if (total !== record.bytes) throw new Error();
    return { record, details, blob: new Blob(parts, { type: details.mimeType }) };
  } catch { throw new Error('Local recording data is incomplete or damaged.'); }
}
export async function deleteLocalRecording(ownerId: string, id: string) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
    const store = tx.objectStore('recordings'), get = store.get(id);
    get.onsuccess = () => {
      const row = get.result as LocalRecording | undefined;
      if (!row || row.ownerId !== ownerId) { tx.abort(); return; }
      store.delete(id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    };
    await done(tx);
  } finally { db.close(); }
}
