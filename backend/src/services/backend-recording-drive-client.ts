import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';
import type { DriveFolder, DriveFolderPage, RecordingDriveFolderClient } from './recording-drive-folder.service.js';
import type { IntegrationCredentialService } from './drive-security.service.js';
import { assertVerifiedRoot, type OAuthConfig, type OAuthTransport } from './google-drive-oauth.service.js';

const folderMimeType = 'application/vnd.google-apps.folder';

// No router constructs this client in Stage B. Its operations are fixed to the
// configured root; it cannot browse arbitrary file IDs or Drive-wide results.
export class BackendRecordingDriveClient implements RecordingDriveFolderClient {
  constructor(private readonly config: OAuthConfig, private readonly transport: OAuthTransport,
    private readonly credentials: IntegrationCredentialService, private readonly fetcher: typeof fetch = fetch) {}

  private async accessToken(): Promise<string> {
    const stored = await this.credentials.loadForBackend();
    if (!stored) throw new Error('Google Drive is not connected.');
    const result = await this.transport.refresh(this.config, stored.refreshToken);
    if (!result.access_token) throw new Error('Google Drive authorization expired. Reconnect the integration.');
    if (result.refresh_token) await this.credentials.replace(this.config.administratorId, stored.googleAccountEmail, result.refresh_token, stored.generation, stored.ciphertext);
    else await this.credentials.assertGeneration(stored.generation);
    return result.access_token;
  }

  private async authorizedRoot(token: string) {
    const rootId = recordingDriveRootId();
    const root = await this.transport.rootMetadata(token, rootId);
    assertVerifiedRoot(root, rootId);
    return root;
  }

  private async request(url: URL, token: string, init?: RequestInit): Promise<any> {
    const response = await this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Google Drive folder request failed.');
    return response.json();
  }

  async listChildren(parentId: string, pageToken?: string): Promise<DriveFolderPage> {
    if (parentId !== recordingDriveRootId()) throw new Error('Folder is outside the configured recording root.');
    const token = await this.accessToken();
    await this.authorizedRoot(token);
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: `'${parentId}' in parents and mimeType = '${folderMimeType}' and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,trashed,capabilities(canAddChildren))', pageSize: '100',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) }).toString();
    const data = await this.request(url, token) as DriveFolderPage;
    return { files: (data.files ?? []).filter(file => file.parents?.includes(parentId) && !file.trashed && file.mimeType === folderMimeType), nextPageToken: data.nextPageToken };
  }

  async getFolder(folderId: string): Promise<DriveFolder | null> {
    validateDriveFolderId(folderId);
    const rootId = recordingDriveRootId();
    if (folderId === rootId) {
      const token = await this.accessToken();
      const root = await this.authorizedRoot(token);
      return { id: rootId, name: 'Recording root', mimeType: root.mimeType!, trashed: root.trashed,
        capabilities: { canAddChildren: root.capabilities!.canAddChildren } };
    }
    // Search only direct children; never fetch an arbitrary ID supplied by a caller.
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.listChildren(rootId, pageToken);
      const found = page.files.find(file => file.id === folderId);
      if (found) return found;
      pageToken = page.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw new Error('Google Drive returned a repeated folder page.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return null;
  }

  async createFolder(parentId: string, name: string): Promise<DriveFolder> {
    if (parentId !== recordingDriveRootId()) throw new Error('Folder is outside the configured recording root.');
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 255 || /[\x00-\x1f\/]/.test(trimmed)) throw new Error('Invalid recording folder name.');
    const token = await this.accessToken();
    await this.authorizedRoot(token);
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ fields: 'id,name,mimeType,parents,trashed', supportsAllDrives: 'true' }).toString();
    const folder = await this.request(url, token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, mimeType: folderMimeType, parents: [parentId] }) }) as DriveFolder;
    if (!folder.parents?.includes(parentId) || folder.mimeType !== folderMimeType || folder.trashed) throw new Error('Google Drive did not create a folder inside the recording root.');
    validateDriveFolderId(folder.id);
    return folder;
  }
}
