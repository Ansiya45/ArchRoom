import type { IncomingMessage } from 'node:http';
import { env } from '../env.js';
import { client } from '../db/index.js';
import { getBearerToken, verifyJwt } from '../utils/jwt.js';
import { isSessionActive } from './auth-session.service.js';
import { CompanyRecordingJobsService } from './company-recording-jobs.service.js';
import { LocalRecordingIngestion } from './local-recording-ingestion.service.js';
import { createLocalIngestionHandler } from './local-recording-ingestion.http.js';

// Same JWT/session validation as the existing tRPC context; never cookie-based auth.
export async function authenticateStagingRequest(req: IncomingMessage) {
  const token = getBearerToken(req.headers.authorization);
  if (!token) return null;
  let payload;
  try { payload = verifyJwt(token); } catch { return null; }
  return await isSessionActive(payload) ? payload.sub : null;
}

export function localIngestionHandler(origins: Set<string>) {
  const jobs = new CompanyRecordingJobsService(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED);
  const service = new LocalRecordingIngestion(client, {
    nodeEnv: env.NODE_ENV, jobsEnabled: env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,
    localEnabled: env.LOCAL_RECORDING_STAGING_ENABLED, databaseUrl: env.DATABASE_URL,
  }, (id, user) => jobs.status(id, user));
  return createLocalIngestionHandler(service, authenticateStagingRequest, origins);
}
