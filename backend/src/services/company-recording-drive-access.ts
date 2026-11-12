import { env } from '../env.js';
import { databaseIntegrationCredentialRepository, IntegrationCredentialService, parseTokenKey } from './drive-security.service.js';
import { GoogleOAuthHttpTransport, validateOAuthConfig } from './google-drive-oauth.service.js';
import type { CompanyDriveAccess } from './company-recording-drive-intent.service.js';

// Backend-only account adapter. No router or worker invokes this in this phase.
// It uses the existing centrally managed encrypted company credential, never a
// host's personal Google token. No OAuth scope or provider permission changes.
export function companyRecordingDriveAccess(): () => Promise<CompanyDriveAccess> {
  const config = validateOAuthConfig({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: env.GOOGLE_OAUTH_CALLBACK_URL, administratorId: env.GOOGLE_INTEGRATION_ADMIN_USER_ID });
  const credentials = new IntegrationCredentialService(databaseIntegrationCredentialRepository, config.administratorId,
    parseTokenKey(env.GOOGLE_INTEGRATION_TOKEN_KEY));
  const transport = new GoogleOAuthHttpTransport();
  return async () => {
    const stored = await credentials.loadForBackend();
    if (!stored) throw new Error('Company Drive is disconnected.');
    const result = await transport.refresh(config, stored.refreshToken);
    if (!result.access_token) throw new Error('Company Drive authorization is unavailable.');
    if (result.refresh_token) await credentials.replace(config.administratorId, stored.googleAccountEmail,
      result.refresh_token, stored.generation, stored.ciphertext);
    else await credentials.assertGeneration(stored.generation);
    const current = await credentials.loadForBackend();
    if (!current || current.generation !== stored.generation || current.googleAccountEmail !== stored.googleAccountEmail ||
      (result.refresh_token ? current.refreshToken !== result.refresh_token : current.ciphertext !== stored.ciphertext))
      throw new Error('Company Drive connection changed.');
    const email = await transport.accountEmail(result.access_token);
    if (email.toLowerCase() !== stored.googleAccountEmail.toLowerCase()) throw new Error('Company Drive account changed.');
    await credentials.assertGeneration(stored.generation);
    return { accountEmail: stored.googleAccountEmail, credentialGeneration: stored.generation, accessToken: result.access_token };
  };
}
