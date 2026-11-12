import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertIntegrationAdministrator, type IntegrationCredentialService } from './drive-security.service.js';
import { recordingDriveRootId } from '../config/recordingDrive.js';

export const driveScope = 'https://www.googleapis.com/auth/drive.file';
const folderMimeType = 'application/vnd.google-apps.folder';
const flowLifetimeMs = 5 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export type OAuthConfig = { clientId: string; clientSecret: string; callbackUrl: string; administratorId: string; };
export type OAuthFlow = { administratorId: string; sessionId: string; generation: string; cookieHash: string; verifier: string; expiresAt: number };
export type GoogleTokens = { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string };
export type RootMetadata = { id?: string; mimeType?: string; trashed?: boolean; isAppAuthorized?: boolean; capabilities?: { canListChildren?: boolean; canAddChildren?: boolean } };
export type DriveConnectionState = 'not_connected' | 'pending' | 'connected' | 'authorization_unavailable' | 'root_unverified' | 'status_unavailable';
export type DriveConnectionStatus = { connected: boolean; pending: boolean; connectionState: DriveConnectionState; accountEmail: string | null };

export interface OAuthTransport {
  exchangeCode(config: OAuthConfig, code: string, verifier: string): Promise<GoogleTokens>;
  refresh(config: OAuthConfig, refreshToken: string): Promise<GoogleTokens>;
  accountEmail(accessToken: string): Promise<string>;
  rootMetadata(accessToken: string, rootId: string): Promise<RootMetadata>;
}

export class OAuthFlowStore {
  private readonly flows = new Map<string, OAuthFlow>();

  create(flow: OAuthFlow): { state: string; cookie: string } {
    for (const [key, old] of this.flows) if (old.expiresAt <= Date.now()) this.flows.delete(key);
    const state = randomBytes(32).toString('base64url');
    const cookie = randomBytes(32).toString('base64url');
    this.flows.set(digest(state), { ...flow, cookieHash: digest(cookie) });
    return { state, cookie };
  }

  consume(state: string, cookie: string): OAuthFlow {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Invalid OAuth state.');
    const key = digest(state);
    const flow = this.flows.get(key);
    this.flows.delete(key); // A failed callback also consumes state.
    if (!flow || flow.expiresAt <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(cookie) ||
        !timingSafeEqual(Buffer.from(flow.cookieHash, 'hex'), Buffer.from(digest(cookie), 'hex'))) {
      throw new Error('Invalid or expired OAuth state.');
    }
    return flow;
  }

  clear(): void { this.flows.clear(); }
}

export function validateOAuthConfig(config: Partial<OAuthConfig>): OAuthConfig {
  if (!config.clientId || !config.clientSecret || !config.administratorId || !config.callbackUrl) throw new Error('Google OAuth is not configured.');
  const url = new URL(config.callbackUrl);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) || url.pathname !== '/google-drive/oauth/callback' ||
      url.username || url.password || url.hash || url.search) {
    throw new Error('Invalid Google OAuth callback URL.');
  }
  return config as OAuthConfig;
}

export function assertVerifiedRoot(root: RootMetadata, selectedId: string): void {
  if (selectedId !== recordingDriveRootId() || root.id !== selectedId || root.mimeType !== folderMimeType || root.trashed !== false || root.isAppAuthorized !== true ||
      root.capabilities?.canListChildren !== true || root.capabilities?.canAddChildren !== true) {
    throw new Error('Configured recording root is not authorized for listing and creating folders.');
  }
}

export class GoogleDriveOAuthService {
  private pending: { googleAccountEmail: string; refreshToken: string; accessToken: string; expiresAt: number; generation: string } | null = null;
  constructor(
    private readonly config: OAuthConfig,
    private readonly flows: OAuthFlowStore,
    private readonly transport: OAuthTransport,
    private readonly credentials: IntegrationCredentialService,
    private readonly sessionActive: (userId: string, sessionId: string) => Promise<boolean>,
  ) {}

  async status(userId: string | undefined): Promise<DriveConnectionStatus> {
    assertIntegrationAdministrator(userId, this.config.administratorId);
    if (this.pending && this.pending.expiresAt <= Date.now()) this.pending = null;
    if (this.pending) {
      const pending = this.pending;
      try {
        if (await this.credentials.generation() !== pending.generation) {
          if (this.pending === pending) this.pending = null;
        } else if (this.pending === pending) {
          return { connected: false, pending: true, connectionState: 'pending', accountEmail: pending.googleAccountEmail };
        }
      } catch { return { connected: false, pending: false, connectionState: 'status_unavailable', accountEmail: null }; }
    }
    let stored: Awaited<ReturnType<IntegrationCredentialService['loadForBackend']>>;
    try { stored = await this.credentials.loadForBackend(); }
    catch { return { connected: false, pending: false, connectionState: 'status_unavailable', accountEmail: null }; }
    if (!stored) return { connected: false, pending: false, connectionState: 'not_connected', accountEmail: null };
    let tokens: GoogleTokens;
    try {
      tokens = await this.transport.refresh(this.config, stored.refreshToken);
      if (!tokens.access_token) throw new Error('Google authorization unavailable.');
    } catch {
      return { connected: false, pending: false, connectionState: 'authorization_unavailable', accountEmail: stored.googleAccountEmail };
    }
    try {
      assertVerifiedRoot(await this.transport.rootMetadata(tokens.access_token, recordingDriveRootId()), recordingDriveRootId());
    } catch {
      return { connected: false, pending: false, connectionState: 'root_unverified', accountEmail: stored.googleAccountEmail };
    }
    try {
      if (tokens.refresh_token) await this.credentials.replace(userId, stored.googleAccountEmail, tokens.refresh_token, stored.generation, stored.ciphertext);
      else await this.credentials.assertGeneration(stored.generation);
    } catch {
      return { connected: false, pending: false, connectionState: 'status_unavailable', accountEmail: null };
    }
    return { connected: true, pending: false, connectionState: 'connected', accountEmail: stored.googleAccountEmail };
  }

  async start(userId: string | undefined, sessionId: string | undefined): Promise<{ authorizationUrl: string; cookie: string }> {
    assertIntegrationAdministrator(userId, this.config.administratorId);
    if (!sessionId) throw new Error('A persistent administrator session is required.');
    this.pending = null;
    const generation = await this.credentials.generation();
    const verifier = randomBytes(32).toString('base64url');
    const { state, cookie } = this.flows.create({ administratorId: userId!, sessionId, generation, cookieHash: '', verifier, expiresAt: Date.now() + flowLifetimeMs });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.callbackUrl,
      response_type: 'code', scope: driveScope, access_type: 'offline', prompt: 'consent select_account',
      include_granted_scopes: 'false', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.toString(), cookie };
  }

  async complete(input: { state: string; cookie: string; code?: string; error?: string }): Promise<void> {
    const flow = this.flows.consume(input.state, input.cookie);
    assertIntegrationAdministrator(flow.administratorId, this.config.administratorId);
    if (!await this.sessionActive(flow.administratorId, flow.sessionId)) throw new Error('Administrator session is no longer active.');
    await this.credentials.assertGeneration(flow.generation);
    if (input.error || !input.code) throw new Error('Google authorization was denied or incomplete.');
    const tokens = await this.transport.exchangeCode(this.config, input.code, flow.verifier);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.scope?.split(' ').includes(driveScope)) {
      throw new Error('Google did not grant the required offline Drive access.');
    }
    const email = await this.transport.accountEmail(tokens.access_token);
    await this.credentials.assertGeneration(flow.generation);
    // Keep a replacement pending until the configured root has been explicitly
    // opened for this app and verified. A failed replacement leaves the old
    // encrypted connection untouched. A restart discards pending consent.
    this.pending = { googleAccountEmail: email, refreshToken: tokens.refresh_token, accessToken: tokens.access_token,
      expiresAt: Date.now() + 5 * 60 * 1000, generation: flow.generation };
  }

  async verifySelectedRoot(userId: string | undefined, selectedId: string): Promise<void> {
    assertIntegrationAdministrator(userId, this.config.administratorId);
    if (selectedId !== recordingDriveRootId()) throw new Error('Selected folder is not the configured recording root.');
    if (this.pending && this.pending.expiresAt <= Date.now()) this.pending = null;
    const pending = this.pending;
    const stored = pending ?? await this.credentials.loadForBackend();
    if (!stored) throw new Error('Google Drive is not connected.');
    await this.credentials.assertGeneration(stored.generation);
    const tokens = await this.transport.refresh(this.config, stored.refreshToken);
    if (!tokens.access_token) throw new Error('Google Drive authorization expired. Reconnect the integration.');
    assertVerifiedRoot(await this.transport.rootMetadata(tokens.access_token, selectedId), selectedId);
    if (pending) {
      await this.credentials.replace(userId, stored.googleAccountEmail, tokens.refresh_token ?? stored.refreshToken, stored.generation);
      if (this.pending === pending) this.pending = null;
    } else if (tokens.refresh_token && 'ciphertext' in stored) {
      await this.credentials.replace(userId, stored.googleAccountEmail, tokens.refresh_token, stored.generation, stored.ciphertext);
    } else await this.credentials.assertGeneration(stored.generation);
  }

  async pickerAccess(userId: string | undefined): Promise<{ accessToken: string; expiresIn: number }> {
    assertIntegrationAdministrator(userId, this.config.administratorId);
    if (this.pending && this.pending.expiresAt <= Date.now()) this.pending = null;
    if (this.pending) {
      const pending = this.pending;
      await this.credentials.assertGeneration(pending.generation);
      return { accessToken: pending.accessToken, expiresIn: Math.max(0, Math.floor((pending.expiresAt - Date.now()) / 1000)) };
    }
    const stored = await this.credentials.loadForBackend();
    if (!stored) throw new Error('Google Drive is not connected.');
    const tokens = await this.transport.refresh(this.config, stored.refreshToken);
    if (!tokens.access_token) throw new Error('Google Drive authorization expired. Reconnect the integration.');
    if (tokens.refresh_token) await this.credentials.replace(userId, stored.googleAccountEmail, tokens.refresh_token, stored.generation, stored.ciphertext);
    else await this.credentials.assertGeneration(stored.generation);
    return { accessToken: tokens.access_token, expiresIn: Math.min(300, Math.max(0, Number(tokens.expires_in ?? 300))) };
  }

  async disconnect(userId: string | undefined): Promise<void> {
    assertIntegrationAdministrator(userId, this.config.administratorId);
    this.flows.clear();
    this.pending = null;
    await this.credentials.disconnect(userId);
  }
}

export class GoogleOAuthHttpTransport implements OAuthTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async tokenRequest(config: OAuthConfig, parameters: Record<string, string>): Promise<GoogleTokens> {
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Google token request failed.');
    return await response.json() as GoogleTokens;
  }
  exchangeCode(config: OAuthConfig, code: string, verifier: string) {
    return this.tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.callbackUrl, code_verifier: verifier });
  }
  refresh(config: OAuthConfig, refreshToken: string) {
    return this.tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
  }
  async accountEmail(accessToken: string): Promise<string> {
    const response = await this.fetcher('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Google account identity could not be verified.');
    const data = await response.json() as { user?: { emailAddress?: string } };
    if (!data.user?.emailAddress) throw new Error('Google account identity could not be verified.');
    return data.user.emailAddress;
  }
  async rootMetadata(accessToken: string, rootId: string): Promise<RootMetadata> {
    if (rootId !== recordingDriveRootId()) throw new Error('Invalid recording root.');
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootId)}`);
    url.search = new URLSearchParams({ fields: 'id,mimeType,trashed,isAppAuthorized,capabilities(canListChildren,canAddChildren)', supportsAllDrives: 'true' }).toString();
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Configured recording root could not be verified.');
    return await response.json() as RootMetadata;
  }
}
