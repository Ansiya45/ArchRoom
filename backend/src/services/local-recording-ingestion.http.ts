import type { IncomingMessage, ServerResponse } from 'node:http';
import { IngestionError, type LocalRecordingIngestion } from './local-recording-ingestion.service.js';
import { readBoundedRecordingChunk, validateRecordingChunkRange, DRIVE_CHUNK_ALIGNMENT } from './company-recording-transfer-protocol.js';

type Authenticator = (req: IncomingMessage, res: ServerResponse) => Promise<string | null>;
// Four bounded bodies per process; DB locks coordinate all processes.
export function createLocalIngestionHandler(service: LocalRecordingIngestion, authenticate: Authenticator, origins: Set<string>) {
  let active = 0;
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let counted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      service.requireEnabled();
      if (req.headers.origin) {
        if (!origins.has(req.headers.origin)) throw new IngestionError(403, 'ORIGIN_NOT_ALLOWED');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Range');
        res.writeHead(204); res.end(); return;
      }
      const match = /^\/recording-staging\/jobs\/([0-9a-f-]{36})\/recordings\/([0-9a-f-]{36})\/(chunks|progress|verify)$/i.exec(req.url ?? '');
      if (!match) throw new IngestionError(404, 'ENDPOINT_NOT_FOUND');
      const action = match[3];
      if (req.method !== (action === 'progress' ? 'GET' : 'POST')) throw new IngestionError(405, 'METHOD_NOT_ALLOWED');
      if (active >= 4) throw new IngestionError(429, 'STAGING_BUSY');
      active++; counted = true;
      // Covers authentication, body arrival, and response. Destroying an incomplete
      // request prevents a timed-out stream from becoming an accepted chunk.
      timer = setTimeout(() => { if (!res.writableEnded) { res.destroy(); req.destroy(); } }, action === 'verify' ? 90000 : 30000);
      timer.unref();
      const userId = await authenticate(req, res);
      if (!userId) throw new IngestionError(401, 'AUTHENTICATION_REQUIRED');
      const binding = { userId, jobId: match[1], recordingId: match[2] };
      if (req.destroyed) throw new IngestionError(408, 'REQUEST_ABORTED');
      let result;
      if (action === 'chunks') {
        if (req.headers['content-type'] !== 'application/octet-stream' || req.headers['content-encoding'] || req.headers['transfer-encoding'])
          throw new IngestionError(400, 'INVALID_BINARY_REQUEST');
        const progress = await service.status(binding);
        const header = req.headers['content-range'];
        const lengthHeader = req.headers['content-length'];
        if (typeof header !== 'string' || typeof lengthHeader !== 'string' || !/^[1-9]\d*$/.test(lengthHeader)) throw new IngestionError(400, 'INVALID_CHUNK_HEADERS');
        const start = Number(/^bytes (\d+)-/.exec(header)?.[1]);
        let range;
        try {
          range = validateRecordingChunkRange(header, progress.byteLength, start);
          if (range.length !== Number(lengthHeader) || start % DRIVE_CHUNK_ALIGNMENT !== 0 || start > progress.ingestionOffset) throw new Error();
        } catch { throw new IngestionError(400, 'INVALID_CHUNK_HEADERS'); }
        let bytes: Buffer;
        try { bytes = await readBoundedRecordingChunk(req, range.length); }
        catch { throw new IngestionError(400, 'INCOMPLETE_CHUNK_BODY'); }
        if (!req.complete || req.aborted || res.destroyed) throw new IngestionError(408, 'REQUEST_ABORTED');
        // A logout during a slow request must be noticed before staging its bytes.
        if (await authenticate(req, res) !== userId) throw new IngestionError(401, 'AUTHENTICATION_REQUIRED');
        if (res.destroyed) throw new IngestionError(408, 'REQUEST_ABORTED');
        result = await service.ingest(binding, header, bytes);
      } else {
        if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0'))
          throw new IngestionError(400, 'UNEXPECTED_REQUEST_BODY');
        result = action === 'progress' ? await service.status(binding) : await service.verify(binding);
      }
      if (!res.destroyed) { res.writeHead(200); res.end(JSON.stringify(result)); }
    } catch (error) {
      const authCode = (error as { code?: string })?.code;
      const status = error instanceof IngestionError ? error.status : authCode === 'FORBIDDEN' ? 403 : authCode === 'NOT_FOUND' ? 404 : authCode === 'UNAUTHORIZED' ? 401 : 503;
      const code = error instanceof IngestionError ? error.code : status === 503 ? 'STAGING_UNAVAILABLE' : 'RECORDING_ACCESS_DENIED';
      if (!res.destroyed && !res.headersSent) {
        // Do not drain arbitrarily large rejected bodies or allow connection reuse.
        res.setHeader('Connection', 'close');
        res.writeHead(status); res.end(JSON.stringify({ error: code }), () => { if (!req.complete) req.destroy(); });
      }
    } finally { if (timer) clearTimeout(timer); if (counted) active--; }
  };
}
