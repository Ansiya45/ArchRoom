import type { StagingConfig } from './local-recording-ingestion.service.js';
import { requireLocalStaging } from './local-recording-ingestion.service.js';
import { parseTokenKey, decryptRefreshToken } from './drive-security.service.js';
import { validateOAuthConfig } from './google-drive-oauth.service.js';
import { recordingDriveRootId } from '../config/recordingDrive.js';
import { companyRecordingSharingReadiness } from './company-recording-sharing-readiness.js';

type CapabilityConfig = StagingConfig & { clientId?: string; clientSecret?: string; callbackUrl?: string; administratorId?: string; tokenKey?: string };
// No provider call is made here. Availability permits an attempt; the pipeline
// still rechecks account, destination and effective permissions at each stage.
export async function companyRecordingCapability(config: CapabilityConfig, inspectDatabase: () => Promise<{ ciphertext: string } | null>) {
  try {
    requireLocalStaging(config);
    validateOAuthConfig({ clientId: config.clientId, clientSecret: config.clientSecret, callbackUrl: config.callbackUrl, administratorId: config.administratorId });
    const key = parseTokenKey(config.tokenKey);
    recordingDriveRootId();
    const stored = await inspectDatabase();
    if (!stored || !decryptRefreshToken(stored.ciphertext, key)) return { available: false };
    if (!companyRecordingSharingReadiness(config).ready) return { available: false };
    return { available: true };
  } catch { return { available: false }; }
}
