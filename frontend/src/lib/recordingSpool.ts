// Durable on-device spool for in-progress meeting recordings.
//
// MediaRecorder chunks are written here as they arrive so a browser crash,
// power loss or accidental tab close never takes the whole recording down.
// IndexedDB stores Blob values on disk, not in memory, so multi-hour
// recordings do not grow the page's memory footprint.
//
// A spool record additionally carries the Google Drive upload cursor
// (uploadedBytes, sessionUrl, fileId) so an interrupted upload can be
// resumed on the next visit instead of restarted.

export type SpooledRecording = {
  id: string;
  meetingCode: string;
  occurrenceId?: string;
  fileName: string;
  mimeType: string;
  startedAt: number;
  stoppedAt: number | null;
  totalBytes: number;
  chunkCount: number;
  // Drive upload state
  driveFileId: string | null;
  driveSessionUrl: string | null;
  driveFolderId: string | null;
  uploadedBytes: number;
  driveUrl: string | null;
  finalized: boolean;
};

type ChunkRow = { spoolId: string; seq: number; blob: Blob };

const DB_NAME = 'ylaam-recording-spool';
const DB_VERSION = 1;
const SPOOL = 'spool';
const CHUNKS = 'chunks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SPOOL)) db.createObjectStore(SPOOL, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const store = db.createObjectStore(CHUNKS, { keyPath: ['spoolId', 'seq'] });
        store.createIndex('bySpool', 'spoolId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable.'));
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Recording spool operation failed.'));
    tx.onerror = () => reject(tx.error ?? new Error('Recording spool operation failed.'));
  });
}

export async function createSpool(meta: Omit<SpooledRecording, 'totalBytes' | 'chunkCount' | 'uploadedBytes' | 'driveFileId' | 'driveSessionUrl' | 'driveFolderId' | 'driveUrl' | 'finalized' | 'stoppedAt'>): Promise<SpooledRecording> {
  const db = await openDb();
  const record: SpooledRecording = {
    ...meta, stoppedAt: null, totalBytes: 0, chunkCount: 0,
    driveFileId: null, driveSessionUrl: null, driveFolderId: null,
    uploadedBytes: 0, driveUrl: null, finalized: false,
  };
  await run(db, SPOOL, 'readwrite', store => store.put(record));
  db.close();
  return record;
}

export async function appendChunk(spoolId: string, seq: number, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS, SPOOL], 'readwrite');
      tx.objectStore(CHUNKS).put({ spoolId, seq, blob } satisfies ChunkRow);
      const get = tx.objectStore(SPOOL).get(spoolId);
      get.onsuccess = () => {
        const record = get.result as SpooledRecording | undefined;
        if (record) {
          record.chunkCount = Math.max(record.chunkCount, seq + 1);
          record.totalBytes += blob.size;
          tx.objectStore(SPOOL).put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Unable to spool a recording chunk.'));
    });
  } finally {
    db.close();
  }
}

export async function updateSpool(spoolId: string, patch: Partial<SpooledRecording>): Promise<void> {
  const db = await openDb();
  try {
    const record = await run<SpooledRecording | undefined>(db, SPOOL, 'readonly', store => store.get(spoolId) as IDBRequest<SpooledRecording | undefined>);
    if (!record) return;
    Object.assign(record, patch);
    await run(db, SPOOL, 'readwrite', store => store.put(record));
  } finally {
    db.close();
  }
}

export async function getSpool(spoolId: string): Promise<SpooledRecording | undefined> {
  const db = await openDb();
  try {
    return await run<SpooledRecording | undefined>(db, SPOOL, 'readonly', store => store.get(spoolId) as IDBRequest<SpooledRecording | undefined>);
  } finally {
    db.close();
  }
}

export async function getChunk(spoolId: string, seq: number): Promise<Blob | undefined> {
  const db = await openDb();
  try {
    const row = await run<ChunkRow | undefined>(db, CHUNKS, 'readonly', store => store.get([spoolId, seq]) as IDBRequest<ChunkRow | undefined>);
    return row?.blob;
  } finally {
    db.close();
  }
}

// Returns every chunk in sequence order. Blobs come straight from disk-backed
// storage; concatenate them with `new Blob(chunks)` for a playable file.
export async function getAllChunks(spoolId: string): Promise<Blob[]> {
  const db = await openDb();
  try {
    const rows = await run<ChunkRow[]>(db, CHUNKS, 'readonly', store => store.getAll(IDBKeyRange.bound([spoolId, -Infinity], [spoolId, Infinity])) as IDBRequest<ChunkRow[]>);
    rows.sort((a, b) => a.seq - b.seq);
    return rows.map(row => row.blob);
  } finally {
    db.close();
  }
}

export async function assembleSpoolBlob(spoolId: string): Promise<Blob | null> {
  const record = await getSpool(spoolId);
  const chunks = await getAllChunks(spoolId);
  if (!chunks.length) return null;
  return new Blob(chunks, { type: (record?.mimeType || 'video/webm').split(';')[0] });
}

export async function listUnfinishedSpools(): Promise<SpooledRecording[]> {
  const db = await openDb();
  try {
    const all = await run<SpooledRecording[]>(db, SPOOL, 'readonly', store => store.getAll() as IDBRequest<SpooledRecording[]>);
    return all.filter(record => !record.finalized).sort((a, b) => b.startedAt - a.startedAt);
  } finally {
    db.close();
  }
}

export async function deleteSpool(spoolId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([CHUNKS, SPOOL], 'readwrite');
      const index = tx.objectStore(CHUNKS).index('bySpool');
      const cursor = index.openCursor(IDBKeyRange.only(spoolId));
      cursor.onsuccess = () => {
        if (cursor.result) { cursor.result.delete(); cursor.result.continue(); }
      };
      tx.objectStore(SPOOL).delete(spoolId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Unable to clear the recording spool.'));
    });
  } finally {
    db.close();
  }
}
