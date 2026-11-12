import { env } from '../env.js';
import { recordingDriveRootId } from '../config/recordingDrive.js';
import { parseTokenKey } from './drive-security.service.js';
import { validateOAuthConfig } from './google-drive-oauth.service.js';
import { requireLocalStaging, type StagingConfig } from './local-recording-ingestion.service.js';

type SharingReadinessConfig = StagingConfig & {
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  administratorId?: string;
  tokenKey?: string;
};

function runtimeConfig(): SharingReadinessConfig {
  return {
    nodeEnv: env.NODE_ENV,
    jobsEnabled: env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,
    localEnabled: env.LOCAL_RECORDING_STAGING_ENABLED,
    databaseUrl: env.DATABASE_URL,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL,
    administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID,
    tokenKey: env.GOOGLE_INTEGRATION_TOKEN_KEY,
  };
}

// This is a configuration gate only. The capability endpoint additionally
// verifies the encrypted company credential, while every pipeline stage still
// revalidates account generation, destination access and the uploaded file.
// requireLocalStaging keeps production closed and restricts processing to an
// explicitly enabled loopback disposable database.
export function companyRecordingSharingReadiness(config: SharingReadinessConfig = runtimeConfig()): { ready: boolean; reason: string } {
  try {
    requireLocalStaging(config);
    validateOAuthConfig({ clientId: config.clientId, clientSecret: config.clientSecret,
      callbackUrl: config.callbackUrl, administratorId: config.administratorId });
    if (parseTokenKey(config.tokenKey).length !== 32) throw new Error('Invalid token key.');
    recordingDriveRootId();
    return { ready: true, reason: 'Company recording upload prerequisites are configured.' };
  } catch {
    return { ready: false, reason: 'Company recording upload prerequisites are unavailable.' };
  }
}
