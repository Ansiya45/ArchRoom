// Streaming resumable upload to Google Drive.
//
// Unlike uploadRecordingToDrive (which needs the finished file first), this
// starts a resumable session whose total size is unknown and feeds recorder
// chunks into it while the meeting is still running. A crash then loses at
// most the unflushed tail instead of the entire recording, and the partially
// uploaded data can be finished later by replaying the on-device spool.
//
// Drive resumable rules followed here:
//  - every PUT except the final one carries `Content-Range: bytes start-end/*`
//    and a body size that is a multiple of 256 KiB;
//  - the final PUT declares `Content-Range: bytes start-end/total` and creates
//    the file;
//  - a fresh session can always replace a stale one because the file ID is
//    reserved up front and nothing completes until the final PUT lands.

const CHUNK_ALIGN = 256 * 1024;
const FLUSH_SIZE = 2 * CHUNK_ALIGN; // 512 KiB per PUT — bounds loss, keeps request rate low
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_API = 'https://www.googleapis.com/drive/v3/files';

export type DriveToken = { token: string; expiresAt: number };
export type DriveSessionInfo = { fileId: string; sessionUrl: string };

function auth(connection: DriveToken) {
  if (Date.now() >= connection.expiresAt) throw new Error('Google access expired. Reconnect Google Drive, then retry the upload.');
  return { Authorization: `Bearer ${connection.token}` };
}

async function check(response: Response) {
  if (response.ok || response.status === 308) return;
  if (response.status === 401) throw new Error('Google access expired. Reconnect Google Drive, then retry.');
  if (response.status === 403 || response.status === 404) throw new Error('Drive access was denied. Check folder permissions and storage quota.');
  throw new Error(`Google Drive request failed (${response.status}). Please retry.`);
}

function acknowledgedOffset(response: Response): number | null {
  const match = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') ?? '');
  return match ? Number(match[1]) + 1 : null;
}

const temporary = (response: Response) => response.status === 429 || response.status >= 500;

export class IncrementalDriveUpload {
  private connection: DriveToken;
  private sessionUrl = '';
  private fileId = '';
  private offset = 0;
  private queue: Blob[] = [];
  private queuedBytes = 0;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private failed: Error | null = null;
  private readonly mimeType: string;
  private readonly folderId: string;
  private readonly fileName: string;

  private constructor(connection: DriveToken, folderId: string, fileName: string, mimeType: string) {
    this.connection = connection;
    this.folderId = folderId;
    this.fileName = fileName;
    this.mimeType = mimeType.split(';')[0] || 'video/webm';
  }

  static async open(connection: DriveToken, folderId: string, fileName: string, mimeType: string): Promise<IncrementalDriveUpload> {
    const upload = new IncrementalDriveUpload(connection, folderId, fileName, mimeType);
    const ids = await fetch(`${FILES_API}/generateIds?count=1&space=drive&type=files`, {
      headers: auth(connection), signal: AbortSignal.timeout(20000),
    });
    await check(ids);
    const { ids: [fileId] } = await ids.json();
    upload.fileId = fileId;
    await upload.startSession();
    return upload;
  }

  private async startSession() {
    const response = await fetch(`${UPLOAD_API}?uploadType=resumable&supportsAllDrives=true`, {
      method: 'POST',
      headers: { ...auth(this.connection), 'Content-Type': 'application/json', 'X-Upload-Content-Type': this.mimeType },
      body: JSON.stringify({ id: this.fileId, name: this.fileName, parents: [this.folderId] }),
      signal: AbortSignal.timeout(30000),
    });
    await check(response);
    const location = response.headers.get('Location');
    if (!location) throw new Error('Google did not return an upload location. Please retry.');
    this.sessionUrl = location;
  }

  // Queue recorder output. Returns immediately; the pump uploads in order.
  push(blob: Blob) {
    if (this.closed || this.failed) return;
    this.queue.push(blob);
    this.queuedBytes += blob.size;
    this.flushing ??= this.pump().finally(() => { this.flushing = null; });
  }

  get uploadedBytes() { return this.offset; }
  get error() { return this.failed; }
  get targetFileId() { return this.fileId; }

  private async put(body: Blob, total: number | '*') {
    // A zero-length final PUT declares `bytes */total`, not a byte span.
    const range = body.size === 0 ? `bytes */${total}` : `bytes ${this.offset}-${this.offset + body.size - 1}/${total}`;
    return fetch(this.sessionUrl, {
      method: 'PUT',
      headers: { ...auth(this.connection), 'Content-Range': range },
      body, signal: AbortSignal.timeout(120000),
    });
  }

  private takeFromQueue(bytes: number): Blob {
    const parts: Blob[] = [];
    let remaining = bytes;
    while (remaining > 0) {
      const head = this.queue[0];
      if (head.size <= remaining) { parts.push(head); this.queue.shift(); remaining -= head.size; }
      else { parts.push(head.slice(0, remaining)); this.queue[0] = head.slice(remaining); remaining = 0; }
    }
    this.queuedBytes -= bytes;
    return new Blob(parts);
  }

  private async pump() {
    try {
      while (this.queuedBytes >= FLUSH_SIZE) {
        const take = Math.floor(Math.min(this.queuedBytes, FLUSH_SIZE) / CHUNK_ALIGN) * CHUNK_ALIGN;
        if (take <= 0) break;
        await this.send(this.takeFromQueue(take), '*', false);
      }
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error('Drive upload failed.');
    }
  }

  private async send(body: Blob, total: number | '*', isFinal: boolean) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await this.put(body, total);
        if (temporary(response)) throw new Error('temporary');
        await check(response);
        if (response.status === 308) {
          if (isFinal) throw new Error('Google Drive did not complete the upload.');
          const ack = acknowledgedOffset(response);
          if (ack === null || ack >= this.offset + body.size) { this.offset += body.size; }
          else {
            // Server kept only part of the piece; put the unsent tail back.
            this.queue.unshift(body.slice(ack - this.offset));
            this.queuedBytes += body.size - (ack - this.offset);
            this.offset = ack;
          }
          return;
        }
        this.offset += body.size;
        return;
      } catch (error) {
        if (attempt === 4) throw error instanceof Error ? error : new Error('Drive upload failed.');
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  // Sends the remaining bytes with the declared total, completing the Drive
  // file. Returns the shareable file URL.
  async finish(): Promise<{ fileId: string; url: string; size: number }> {
    this.closed = true;
    if (this.flushing) await this.flushing.catch(() => undefined);
    if (this.failed) throw this.failed;
    while (this.queuedBytes >= FLUSH_SIZE) {
      const take = Math.floor(Math.min(this.queuedBytes, FLUSH_SIZE) / CHUNK_ALIGN) * CHUNK_ALIGN;
      await this.send(this.takeFromQueue(take), '*', false);
    }
    // The final PUT completes the file; an empty body still declares the total.
    const remaining = this.queuedBytes > 0 ? this.takeFromQueue(this.queuedBytes) : new Blob();
    await this.send(remaining, this.offset + remaining.size, true);
    if (this.failed) throw this.failed;
    return { fileId: this.fileId, url: `https://drive.google.com/file/d/${this.fileId}/view`, size: this.offset };
  }
}

// Recovery path: replay on-disk spooled chunks into a fresh Drive session.
export async function uploadSpooledToDrive(connection: DriveToken, folderId: string, fileName: string,
  mimeType: string, chunks: Blob[], onProgress?: (uploaded: number, total: number) => void) {
  const upload = await IncrementalDriveUpload.open(connection, folderId, fileName, mimeType);
  const total = chunks.reduce((sum, blob) => sum + blob.size, 0);
  for (const blob of chunks) {
    upload.push(blob);
    onProgress?.(upload.uploadedBytes, total);
  }
  const result = await upload.finish();
  onProgress?.(total, total);
  return { ...result, size: total };
}
