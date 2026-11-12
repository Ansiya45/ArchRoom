import { isSessionActive } from './auth-session.service.js';
import { databaseIntegrationCredentialRepository, IntegrationCredentialService, parseTokenKey } from './drive-security.service.js';
import { GoogleDriveOAuthService, GoogleOAuthHttpTransport, OAuthFlowStore, validateOAuthConfig } from './google-drive-oauth.service.js';
import { env } from '../env.js';
import { BackendRecordingDriveClient } from './backend-recording-drive-client.js';
import { RecordingDriveFolderService } from './recording-drive-folder.service.js';
import { recordingDestinationPrivacyService, type DestinationPrivacyResult } from './recording-destination-privacy.service.js';

const flows = new OAuthFlowStore();
let service: GoogleDriveOAuthService | undefined;

export function googleDriveOAuth(): GoogleDriveOAuthService {
  if (service) return service;
  const config = validateOAuthConfig({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL, administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID });
  service = new GoogleDriveOAuthService(config, flows, new GoogleOAuthHttpTransport(),
    new IntegrationCredentialService(databaseIntegrationCredentialRepository, config.administratorId, parseTokenKey(env.GOOGLE_INTEGRATION_TOKEN_KEY)),
    async (userId, sessionId) => isSessionActive({ sub: userId, sid: sessionId, email: '' }));
  return service;
}

export function recordingFolderService(): RecordingDriveFolderService {
  const config = validateOAuthConfig({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL, administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID });
  const credentials = new IntegrationCredentialService(databaseIntegrationCredentialRepository, config.administratorId,
    parseTokenKey(env.GOOGLE_INTEGRATION_TOKEN_KEY));
  return new RecordingDriveFolderService(new BackendRecordingDriveClient(config, new GoogleOAuthHttpTransport(), credentials));
}

// This factory does not expose a router or start an upload. Future upload
// code must use the fail-closed wrapper below immediately before creation.
export function recordingDestinationPrivacy() {
  const config = validateOAuthConfig({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL, administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID });
  const credentials = new IntegrationCredentialService(databaseIntegrationCredentialRepository, config.administratorId,
    parseTokenKey(env.GOOGLE_INTEGRATION_TOKEN_KEY));
  return recordingDestinationPrivacyService(config, new GoogleOAuthHttpTransport(), credentials);
}

export async function validateRecordingDestinationImmediatelyBeforeFileCreation(
  input: { meetingCode: string; occurrenceId?: string }, userId: string,
): Promise<DestinationPrivacyResult> {
  try { return await recordingDestinationPrivacy().validateImmediatelyBeforeFileCreation(input, userId); }
  catch { return { status: 'UNVERIFIABLE', reason: 'Company Drive destination privacy could not be verified.' }; }
}

export async function validateCompanyRecordingRoot(input: { meetingCode: string; occurrenceId?: string }, userId: string): Promise<DestinationPrivacyResult> {
  try { return await recordingDestinationPrivacy().validateCompanyRoot(input, userId); }
  catch { return { status: 'UNVERIFIABLE', reason: 'Company recording destination could not be verified.' }; }
}

export async function validateCompanyRecordingDestination(
  input: { meetingCode: string; occurrenceId?: string }, userId: string, folderId: string,
): Promise<DestinationPrivacyResult> {
  try { return await recordingDestinationPrivacy().validateJobDestinationImmediatelyBeforeFileCreation(input, userId, folderId); }
  catch {
    console.warn('Company recording destination inspection exception', {
      stage: 'destination_validator_setup', kind: 'validation_failure',
    });
    return { status: 'UNVERIFIABLE', reason: 'Company recording destination could not be verified.' };
  }
}
