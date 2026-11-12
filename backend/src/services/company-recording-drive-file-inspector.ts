// Independent, fail-closed inspection of a binary recording already transferred
// to Drive. This never creates a file, changes permissions, or publishes a link.
export type FileInspection =
  | { status: 'SAFE'; fileId: string; destinationId: string; size: number; mimeType: string; sha256: string; checkedAt: string }
  | { status: 'BLOCKED' | 'UNVERIFIABLE'; reason: string };

export type ExpectedPrivateReader = { userId: string; email: string };
export type ExpectedFile = { fileId: string; destinationId: string; byteLength: number;
  mimeType: 'video/webm' | 'video/mp4'; sha256: string; companyEmail: string; privateReaders?: readonly ExpectedPrivateReader[]; sharingMode?: 'private'|'restricted'|'anyone_with_link'; allowMissingPrivateReaders?: boolean; manualSharing?: boolean };
type Metadata = { id?: unknown; size?: unknown; mimeType?: unknown; parents?: unknown; trashed?: unknown;
  driveId?: unknown; sha256Checksum?: unknown; ownedByMe?: unknown; version?: unknown;
  owners?: unknown; inheritedPermissionsDisabled?: unknown };
type Permission = { id?: unknown; type?: unknown; role?: unknown; emailAddress?: unknown;
  deleted?: unknown; pendingOwner?: unknown; view?: unknown; inherited?: unknown; permissionDetails?: unknown };
type Page = { permissions?: unknown; nextPageToken?: unknown };
const idPattern = /^[A-Za-z0-9_-]{10,128}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const blocked = (reason: string): FileInspection => ({ status: 'BLOCKED', reason });
const unknown = (reason: string): FileInspection => ({ status: 'UNVERIFIABLE', reason });
class DriveFileInspectionHttpError extends Error {
  constructor(readonly status: number) { super('Drive inspection request failed.'); }
}

export class CompanyRecordingDriveFileInspector {
  constructor(private readonly fetcher: typeof fetch) {}

  private async json(url: URL, token: string): Promise<unknown> {
    const response = await this.fetcher(url, { method: 'GET', redirect: 'manual',
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (response.status !== 200) throw new DriveFileInspectionHttpError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Drive inspection unavailable.');
    const parts: Buffer[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 256 * 1024) throw new Error('Drive inspection response exceeded limit.');
        parts.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(parts, length).toString('utf8')) as unknown;
    } finally { reader.releaseLock(); }
  }

  private async metadata(token: string, id: string): Promise<Metadata> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
    url.search = new URLSearchParams({ fields: 'id,size,mimeType,parents,trashed,driveId,sha256Checksum,ownedByMe,version,owners(emailAddress),inheritedPermissionsDisabled',
      supportsAllDrives: 'false' }).toString();
    return await this.json(url, token) as Metadata;
  }

  private async permissions(token: string, id: string, email: string, privateReaders?: readonly ExpectedPrivateReader[], sharingMode?: 'private'|'restricted'|'anyone_with_link', allowMissingPrivateReaders = false, manualSharing = false): Promise<FileInspection | null> {
    let pageToken: string | undefined;
    const tokens = new Set<string>();
    const ids = new Set<string>();
    let owner = false;
    let publicReaders = 0;
    const expected = new Map((privateReaders ?? []).map(reader => [reader.email.toLowerCase(), reader.userId]));
    const anyone = sharingMode === 'anyone_with_link';
    const found = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions`);
      url.search = new URLSearchParams({ fields: manualSharing ? 'nextPageToken,permissions(id,type,role,emailAddress,deleted,pendingOwner,view,permissionDetails(inherited,inheritedFrom,role,permissionType))' : 'nextPageToken,permissions(id,type,role,emailAddress,deleted,pendingOwner,view,inherited)',
        pageSize: '100', supportsAllDrives: 'false', ...(pageToken ? { pageToken } : {}) }).toString();
      const page = await this.json(url, token) as Page;
      if (!Array.isArray(page.permissions)) return unknown('Drive file permissions cannot be established.');
      for (const entry of page.permissions as Permission[]) {
        if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
          typeof entry.type !== 'string' || typeof entry.role !== 'string')
          return unknown('Drive file permissions cannot be established.');
        ids.add(entry.id);
        if (manualSharing) {
          if (entry.type !== 'user' && entry.type !== 'group') return blocked('Drive file permits public or domain access.');
          if (typeof entry.emailAddress !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.emailAddress) || entry.deleted === true || entry.pendingOwner === true || entry.view)
            return unknown('Drive file permissions cannot be established.');
          if (entry.permissionDetails !== undefined && (!Array.isArray(entry.permissionDetails) || entry.permissionDetails.some(detail =>
            !detail || typeof detail !== 'object' || typeof detail.inherited !== 'boolean' || (detail.inheritedFrom !== undefined && typeof detail.inheritedFrom !== 'string'))))
            return unknown('Drive file inheritance metadata is incomplete.');
          if (entry.type === 'user' && entry.emailAddress.toLowerCase() === email) {
            if (entry.role !== 'owner' || owner) return blocked('Drive company ownership is invalid.');
            owner = true;
          } else if (!['reader','commenter','writer'].includes(entry.role)) return blocked('Drive file permission is invalid.');
          continue;
        }
        if ((privateReaders === undefined) && entry.type === 'anyone') {
          if (entry.role !== 'reader' || entry.inherited === true || entry.deleted === true || entry.pendingOwner === true || entry.view || anyone === false) return blocked('Drive public permission is invalid.');
          publicReaders++;
          continue;
        }
        if (entry.type !== 'user') return blocked('Drive file permits unapproved access.');
        if (typeof entry.emailAddress !== 'string' || entry.deleted === true || entry.pendingOwner === true || entry.view || entry.inherited === true)
          return unknown('Drive file permissions cannot be established.');
        const address = entry.emailAddress.toLowerCase();
        if (address === email) { if (entry.role !== 'owner' || owner) return blocked('Drive company ownership is invalid.'); owner = true; }
        else if (privateReaders && expected.has(address)) { if (entry.role !== 'reader') return blocked('Drive reader access is invalid.'); found.add(address); }
        else return blocked('Drive file permits unapproved access.');
      }
      if (page.nextPageToken === undefined || page.nextPageToken === '') {
        if (!owner) return unknown('Drive file owner permission is unavailable.');
        if (privateReaders && !allowMissingPrivateReaders && found.size !== expected.size) return blocked('Drive file is missing an authorized reader.');
        if (anyone && publicReaders !== 1) return blocked('Drive file public reader permission is invalid.');
        return null;
      }
      if (typeof page.nextPageToken !== 'string' || tokens.has(page.nextPageToken))
        return unknown('Drive file permission pagination is incomplete.');
      pageToken = page.nextPageToken;
      tokens.add(pageToken);
    }
    return unknown('Drive file permission pagination is incomplete.');
  }

  async inspect(token: string, expected: ExpectedFile): Promise<FileInspection> {
    if (!token || token.length > 4096 || !idPattern.test(expected.fileId) || !idPattern.test(expected.destinationId) ||
      !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 1 || expected.byteLength > 128 * 1024 * 1024 ||
      !['video/webm', 'video/mp4'].includes(expected.mimeType) || !digestPattern.test(expected.sha256) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected.companyEmail)) return blocked('Drive verification input is invalid.');
    const email = expected.companyEmail.toLowerCase();
    let stage = 'metadata_request';
    try {
      const first = await this.metadata(token, expected.fileId);
      if (first.id !== expected.fileId || first.trashed === true || first.driveId)
        return blocked('Drive file identity or location is invalid.');
      if (Array.isArray(first.parents) && (first.parents.length !== 1 || first.parents[0] !== expected.destinationId))
        return blocked('Drive file is outside the authorized destination.');
      const ownerEmail = Array.isArray(first.owners) && first.owners.length === 1 &&
        (first.owners[0] as { emailAddress?: unknown })?.emailAddress;
      if (first.trashed !== false || !Array.isArray(first.parents) || first.ownedByMe !== true ||
          typeof ownerEmail !== 'string' || ownerEmail.toLowerCase() !== email ||
          first.inheritedPermissionsDisabled !== false)
        return unknown('Drive file location or ownership cannot be established.');
      if (first.mimeType !== expected.mimeType || first.size !== String(expected.byteLength))
        return blocked('Drive file metadata differs from the recording.');
      if (typeof first.sha256Checksum !== 'string' || !digestPattern.test(first.sha256Checksum))
        return unknown('Drive file SHA-256 checksum is unavailable.');
      if (first.sha256Checksum.toLowerCase() !== expected.sha256)
        return blocked('Drive file checksum differs from the recording.');
      if (typeof first.version !== 'string' || !/^\d+$/.test(first.version))
        return unknown('Drive file version is unavailable.');
      if (expected.manualSharing && (expected.privateReaders !== undefined || expected.sharingMode !== undefined || expected.allowMissingPrivateReaders)) return blocked('Drive verification input is invalid.');
      if (expected.allowMissingPrivateReaders && (!expected.privateReaders || expected.sharingMode === 'anyone_with_link')) return blocked('Drive verification input is invalid.');
      stage = 'permission_list_request';
      const permissions = await this.permissions(token, expected.fileId, email, expected.privateReaders, expected.sharingMode, expected.allowMissingPrivateReaders, expected.manualSharing);
      if (permissions) return permissions;
      stage = 'metadata_recheck_request';
      const last = await this.metadata(token, expected.fileId);
      if (JSON.stringify(last) !== JSON.stringify(first)) return unknown('Drive file changed during verification.');
      return { status: 'SAFE', fileId: expected.fileId, destinationId: expected.destinationId,
        size: expected.byteLength, mimeType: expected.mimeType, sha256: expected.sha256, checkedAt: new Date().toISOString() };
    } catch (error) {
      console.warn('Company recording Drive file inspection request', {
        stage, kind: error instanceof DriveFileInspectionHttpError ? 'http_failure' : 'request_failure',
        ...(error instanceof DriveFileInspectionHttpError ? { httpStatus: error.status } : {}),
      });
      return unknown('Drive file cannot be independently verified.');
    }
  }
}
