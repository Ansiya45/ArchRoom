import { isSessionActive } from './auth-session.service.js';
import { databaseIntegrationCredentialRepository, IntegrationCredentialService, parseTokenKey } from './drive-security.service.js';
import { GoogleDriveOAuthService, GoogleOAuthHttpTransport, OAuthFlowStore, validateOAuthConfig } from './google-drive-oauth.service.js';
import { env } from '../env.js';
import { BackendRecordingDriveClient } from './backend-recording-drive-client.js';
import { RecordingDriveFolderService } from './recording-drive-folder.service.js';

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
