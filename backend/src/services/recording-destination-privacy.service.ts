import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';
import { RecordingService } from './recording.service.js';
import { userCanAccessRecordingDestination, type IntegrationCredentialService } from './drive-security.service.js';
import { assertVerifiedRoot, type OAuthConfig, type OAuthTransport } from './google-drive-oauth.service.js';

// A SAFE result describes only the instant the check completed. The future
// uploader must call this method immediately before every file creation.
type DeniedResult = { status: 'BLOCKED' | 'UNVERIFIABLE'; reason: string };
export type DestinationPrivacyResult =
  | { status: 'SAFE'; destinationId: string; checkedAt: string }
  | DeniedResult;
type InspectionResult = DeniedResult |
  { status: 'SAFE'; destinationId: string; checkedAt: string; confirmCurrent: () => Promise<boolean> };
type MeetingSettings = { recordingFolderId: string | null };
type Dependencies = {
  authorize: (meetingCode: string, occurrenceId: string | undefined, userId: string) => Promise<MeetingSettings>;
  mayUseFolder: (userId: string, folderId: string) => Promise<boolean>;
  inspect: (root: string, folder: string | null, allowNamedSharing?: boolean) => Promise<InspectionResult>;
};
// All callers use fixed, non-sensitive messages. Never log provider errors,
// folder IDs, permission records, or OAuth material here.
const blocked = (reason: string): DeniedResult => {
  console.warn('Company recording destination validation', { outcome: 'BLOCKED', reason });
  return { status: 'BLOCKED', reason };
};
const unknown = (reason: string): DeniedResult => {
  console.warn('Company recording destination validation', { outcome: 'UNVERIFIABLE', reason });
  return { status: 'UNVERIFIABLE', reason };
};

class DriveInspectionHttpError extends Error {
  constructor(readonly status: number) { super('Drive inspection request failed.'); }
}

export class RecordingDestinationPrivacyService {
  constructor(private readonly deps: Dependencies) {}

  private async validateAuthorizedDestination(input: { meetingCode: string; occurrenceId?: string }, userId: string,
    folder: string | null, requireMeetingMatch: boolean, authorizationAlreadyChecked = false): Promise<DestinationPrivacyResult> {
    if (!authorizationAlreadyChecked) {
      try { await this.deps.authorize(input.meetingCode, input.occurrenceId, userId); }
      catch { return blocked('Meeting or session authorization could not be verified.'); }
    }
    const root = recordingDriveRootId();
    if (folder !== null) {
      try { validateDriveFolderId(folder); } catch { return blocked('The recording destination is invalid.'); }
      if (folder === root) return blocked('The recording destination is invalid.');
      try { if (!await this.deps.mayUseFolder(userId, folder)) return blocked('Recording destination access is not authorized.'); }
      catch { return unknown('Recording destination authorization is unavailable.'); }
    }
    let result: InspectionResult;
    try { result = await this.deps.inspect(root, folder, true); }
    catch {
      console.warn('Company recording destination inspection exception', {
        stage: 'inspector_invocation', kind: 'validation_failure',
      });
      return unknown('Company Drive destination privacy could not be verified.');
    }
    if (result.status !== 'SAFE') return result;
    if (result.destinationId !== (folder ?? root)) return unknown('Recording destination could not be verified.');
    try {
      const latest = await this.deps.authorize(input.meetingCode, input.occurrenceId, userId);
      if (requireMeetingMatch && latest.recordingFolderId !== folder) return unknown('Recording destination changed during verification.');
      if (folder && !await this.deps.mayUseFolder(userId, folder)) return blocked('Recording destination access is not authorized.');
    } catch { return blocked('Meeting or session authorization could not be verified.'); }
    try { if (!await result.confirmCurrent()) return unknown('Company Drive connection changed during verification.'); }
    catch { return unknown('Company Drive connection could not be verified.'); }
    return { status: 'SAFE', destinationId: result.destinationId, checkedAt: new Date().toISOString() };
  }

  async validateCompanyRoot(input: { meetingCode: string; occurrenceId?: string }, userId: string): Promise<DestinationPrivacyResult> {
    try {
      await this.deps.authorize(input.meetingCode, input.occurrenceId, userId);
      const root = recordingDriveRootId();
      const result = await this.deps.inspect(root, null, true);
      if (result.status !== 'SAFE') return result;
      if (result.destinationId !== root) return unknown('Company recording destination could not be verified.');
      await this.deps.authorize(input.meetingCode, input.occurrenceId, userId);
      if (!await result.confirmCurrent()) return unknown('Company Drive connection changed during verification.');
      return { status: 'SAFE', destinationId: root, checkedAt: new Date().toISOString() };
    } catch { return unknown('Company recording destination could not be verified.'); }
  }

  async validateImmediatelyBeforeFileCreation(input: { meetingCode: string; occurrenceId?: string }, userId: string): Promise<DestinationPrivacyResult> {
    let meeting: MeetingSettings;
    try { meeting = await this.deps.authorize(input.meetingCode, input.occurrenceId, userId); }
    catch { return blocked('Meeting or session authorization could not be verified.'); }
    return this.validateAuthorizedDestination(input, userId, meeting.recordingFolderId, true, true);
  }

  // Upload jobs retain the destination selected when their canonical bytes
  // were accepted. Revalidate that exact snapshot rather than silently
  // following a later meeting-setting change.
  async validateJobDestinationImmediatelyBeforeFileCreation(input: { meetingCode: string; occurrenceId?: string }, userId: string,
    folderId: string): Promise<DestinationPrivacyResult> {
    const root = recordingDriveRootId();
    return this.validateAuthorizedDestination(input, userId, folderId === root ? null : folderId, false);
  }
}

type FolderMetadata = { id?: string; mimeType?: string; trashed?: boolean; parents?: string[]; driveId?: string; version?: string;
  isAppAuthorized?: boolean; ownedByMe?: boolean; capabilities?: { canAddChildren?: boolean; canListChildren?: boolean; canShare?: boolean } };
type Permission = { id?: string; type?: string; role?: string; emailAddress?: string; deleted?: boolean; pendingOwner?: boolean; view?: string };
type PermissionPage = { permissions?: Permission[]; nextPageToken?: string };
const folderMime = 'application/vnd.google-apps.folder';

// My Drive only. The company-root upload path allows named users and groups;
// the legacy private destination path retains its stricter permission policy.
export class CompanyDrivePrivacyInspector {
  constructor(private readonly config: OAuthConfig, private readonly transport: OAuthTransport,
    private readonly credentials: IntegrationCredentialService, private readonly fetcher: typeof fetch = fetch) {}

  async inspect(rootId: string, folderId: string | null, allowNamedSharing = false): Promise<InspectionResult> {
    let stage = 'destination_input';
    try {
      if (rootId !== recordingDriveRootId() || folderId === rootId) return blocked('The recording destination is invalid.');
      if (folderId) validateDriveFolderId(folderId);
      stage = 'credential_load';
      const stored = await this.credentials.loadForBackend();
      if (!stored) return unknown('Company Drive is not connected.');
      stage = 'token_refresh';
      const tokens = await this.transport.refresh(this.config, stored.refreshToken);
      if (!tokens.access_token) return unknown('Company Drive authorization is unavailable.');
      stage = 'credential_recheck';
      if (tokens.refresh_token) await this.credentials.replace(this.config.administratorId, stored.googleAccountEmail, tokens.refresh_token, stored.generation, stored.ciphertext);
      const current = await this.credentials.loadForBackend();
      if (!current || current.generation !== stored.generation || current.googleAccountEmail !== stored.googleAccountEmail ||
          (tokens.refresh_token ? current.refreshToken !== tokens.refresh_token : current.ciphertext !== stored.ciphertext)) return unknown('Company Drive connection changed during verification.');
      const token = tokens.access_token;
      stage = 'account_identity_request';
      const account = await this.transport.accountEmail(token);
      if (account.toLowerCase() !== stored.googleAccountEmail.toLowerCase()) return unknown('Company Drive account could not be verified.');
      stage = 'root_authorization_request';
      const rootAuthorization = await this.transport.rootMetadata(token, rootId);
      stage = 'root_authorization_check';
      assertVerifiedRoot(rootAuthorization, rootId);
      stage = 'root_metadata_request';
      const root = await this.metadata(rootId, token);
      // A configured My Drive folder may be shared with the integration account
      // as an Editor. Its owner's My Drive root is not the integration account's.
      const ownedRoot = root.ownedByMe === true;
      stage = 'owner_root_metadata_request';
      const myRoot = ownedRoot ? await this.metadata('root', token) : null;
      if (myRoot && (!myRoot.id || !/^[A-Za-z0-9_-]{10,128}$/.test(myRoot.id))) return unknown('Company Drive root could not be verified.');
      stage = 'destination_metadata_request';
      const destination = folderId ? await this.metadata(folderId, token) : root;
      stage = 'folder_metadata_check';
      const folders = [...(myRoot ? [[myRoot, myRoot.id] as const] : []), [root, rootId] as const, [destination, folderId ?? rootId] as const];
      for (const [row, expected] of folders) {
        if (row.id !== expected || row.mimeType !== folderMime || row.trashed !== false) return blocked('The recording folder is missing, moved, or unavailable.');
        if (row.driveId) return unknown('Shared-drive access cannot be fully verified.');
        if (row.ownedByMe !== true && (!allowNamedSharing || row.ownedByMe !== false)) return unknown('Folder ownership or permissions cannot be verified.');
        if (ownedRoot && row.ownedByMe !== true) return unknown('Folder ownership or permissions cannot be verified.');
        if ((ownedRoot || !allowNamedSharing) && row.capabilities?.canShare !== true) return unknown('Folder ownership or permissions cannot be verified.');
        if (typeof row.version !== 'string' || !/^\d+$/.test(row.version)) return unknown('Folder metadata cannot be verified.');
      }
      if (root.isAppAuthorized !== true || root.capabilities?.canListChildren !== true || root.capabilities?.canAddChildren !== true) return unknown('The recording root is not authorized for this application.');
      if (myRoot && myRoot.parents !== undefined && (!Array.isArray(myRoot.parents) || myRoot.parents.length !== 0)) return unknown('Folder ancestry cannot be verified.');
      const rootAncestryDiagnostic = {
        parentsFieldPresent: Object.hasOwn(root, 'parents'),
        parentCount: Array.isArray(root.parents) ? root.parents.length : null,
        ownedByMe: root.ownedByMe === true ? 'yes' : root.ownedByMe === false ? 'no' : 'unknown',
        appAuthorized: root.isAppAuthorized === true,
        canListChildren: root.capabilities?.canListChildren === true,
        canAddChildren: root.capabilities?.canAddChildren === true,
      };
      if (!Array.isArray(root.parents)) {
        console.warn('Company recording root ancestry metadata', rootAncestryDiagnostic);
        // An Editor can be authorized for this exact configured folder without
        // access to its owner's parent. The configured folder is the trust
        // boundary; its own ACL is still inspected below. Never infer a child
        // folder's ancestry from this exception.
        if (!allowNamedSharing || root.ownedByMe !== false || root.parents !== undefined)
          return unknown('Folder ancestry cannot be verified.');
      } else if (root.parents.length !== 1 || root.parents[0] === rootId || (myRoot && root.parents[0] !== myRoot.id)) {
        console.warn('Company recording root ancestry metadata', rootAncestryDiagnostic);
        return blocked('The configured recording root is outside its supported location.');
      }
      if (folderId && (!Array.isArray(destination.parents) || destination.parents.length !== 1 || destination.parents[0] !== rootId)) return blocked('The selected folder is no longer a direct child of Recording Sessions.');
      if (destination.isAppAuthorized !== true || destination.capabilities?.canAddChildren !== true) return unknown('The destination is not authorized for this application.');
      stage = 'permission_list_request';
      for (const id of [...new Set([myRoot?.id, rootId, folderId].filter((id): id is string => Boolean(id)))]) {
        const result = await this.permissions(id, token, ownedRoot ? stored.googleAccountEmail : undefined, allowNamedSharing);
        if (result) return result;
      }
      // Permission and ancestry reads are not atomic; detect changes reported
      // by Drive during the scan. A later change is still possible.
      stage = 'metadata_recheck_request';
      for (const [id, before] of [...(myRoot ? [['root', myRoot] as const] : []), [rootId, root] as const, ...(folderId ? [[folderId, destination] as const] : [])]) {
        const after = await this.metadata(id, token);
        if (after.id !== before.id || after.version !== before.version || after.mimeType !== before.mimeType || after.trashed !== before.trashed ||
            after.driveId !== before.driveId || after.ownedByMe !== before.ownedByMe || after.isAppAuthorized !== before.isAppAuthorized ||
            JSON.stringify(after.parents) !== JSON.stringify(before.parents) || JSON.stringify(after.capabilities) !== JSON.stringify(before.capabilities))
          return unknown('Folder metadata changed during verification.');
      }
      stage = 'credential_final_recheck';
      const end = await this.credentials.loadForBackend();
      if (!end || end.generation !== current.generation || end.ciphertext !== current.ciphertext || end.googleAccountEmail !== current.googleAccountEmail)
        return unknown('Company Drive connection changed during verification.');
      return { status: 'SAFE', destinationId: folderId ?? rootId, checkedAt: new Date().toISOString(), confirmCurrent: async () => {
        const latest = await this.credentials.loadForBackend();
        return Boolean(latest && latest.generation === current.generation && latest.ciphertext === current.ciphertext && latest.googleAccountEmail === current.googleAccountEmail);
      } };
    } catch (error) {
      console.warn('Company recording destination inspection exception', {
        stage, kind: stage.endsWith('_request') ? 'request_failure' : 'validation_failure',
        ...(error instanceof DriveInspectionHttpError ? { httpStatus: error.status } : {}),
      });
      return unknown('Company Drive destination privacy could not be verified.');
    }
  }

  private async get(url: URL, token: string): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new DriveInspectionHttpError(response.status);
    return response.json();
  }
  private async metadata(id: string, token: string): Promise<FolderMetadata> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    url.search = new URLSearchParams({ fields: 'id,mimeType,trashed,parents,driveId,version,isAppAuthorized,ownedByMe,capabilities(canAddChildren,canListChildren,canShare)', supportsAllDrives: 'true' }).toString();
    return await this.get(url, token) as FolderMetadata;
  }
  private async permissions(id: string, token: string, expectedOwnerEmail: string | undefined, allowNamedSharing: boolean): Promise<DeniedResult | null> {
    let pageToken: string | undefined; const tokens = new Set<string>(); const ids = new Set<string>(); let foundOwner = false;
    for (let page = 0; page < 100; page++) {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions`);
      url.search = new URLSearchParams({ fields: 'nextPageToken,permissions(id,type,role,emailAddress,deleted,pendingOwner,view)', pageSize: '100', supportsAllDrives: 'true', includePermissionsForView: 'published', ...(pageToken ? { pageToken } : {}) }).toString();
      const result = await this.get(url, token) as PermissionPage;
      if (!Array.isArray(result.permissions)) return unknown('Folder permission metadata is incomplete.');
      for (const permission of result.permissions) {
        if (!permission.id || !permission.type || !permission.role || ids.has(permission.id)) return unknown('Folder permission metadata is incomplete.');
        ids.add(permission.id);
        if (permission.type !== 'user' && permission.type !== 'group') return blocked('The recording destination permits unapproved access.');
        if (!allowNamedSharing && permission.type === 'group') return blocked('The recording destination permits unapproved access.');
        if (!permission.emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(permission.emailAddress) || permission.deleted === true || permission.pendingOwner === true || permission.view) return unknown('Folder permission metadata is incomplete.');
        if (permission.type === 'user' && permission.role === 'owner') {
          if (expectedOwnerEmail && permission.emailAddress.toLowerCase() !== expectedOwnerEmail.toLowerCase()) return unknown('Folder ownership is ambiguous.');
          if (foundOwner) return unknown('Folder ownership is ambiguous.');
          foundOwner = true;
        } else if (!allowNamedSharing || !['reader','commenter','writer'].includes(permission.role)) return blocked('The recording destination permits unapproved access.');
      }
      pageToken = result.nextPageToken;
      if (!pageToken) return foundOwner ? null : unknown('Folder permission metadata is incomplete.');
      if (tokens.has(pageToken)) return unknown('Folder permission pagination is incomplete.');
      tokens.add(pageToken);
    }
    return unknown('Folder permission pagination is incomplete.');
  }
}

// Only server-side settings and existing host/session authorization are used.
export function recordingDestinationPrivacyService(config: OAuthConfig, transport: OAuthTransport, credentials: IntegrationCredentialService) {
  const recording = new RecordingService();
  const inspector = new CompanyDrivePrivacyInspector(config, transport, credentials);
  return new RecordingDestinationPrivacyService({
    authorize: (meetingCode, occurrenceId, userId) => recording.authorizeExport({ meetingCode, occurrenceId }, userId),
    mayUseFolder: (userId, folderId) => userCanAccessRecordingDestination(userId, folderId, 'upload', config.administratorId),
    inspect: (root, folder, allowNamedSharing) => inspector.inspect(root, folder, allowNamedSharing),
  });
}
