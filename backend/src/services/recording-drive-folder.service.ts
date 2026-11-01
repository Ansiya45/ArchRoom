import { recordingDriveRootId, validateDriveFolderId } from '../config/recordingDrive.js';

export type DriveFolder = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  capabilities?: { canAddChildren?: boolean };
};

export type DriveFolderPage = { files: DriveFolder[]; nextPageToken?: string };

// Implementations must use the authenticated Google Drive API. No live client is constructed here.
export interface RecordingDriveFolderClient {
  listChildren(parentId: string, pageToken?: string): Promise<DriveFolderPage>;
  getFolder(folderId: string): Promise<DriveFolder | null>;
  createFolder(parentId: string, name: string): Promise<DriveFolder>;
}

const folderMimeType = 'application/vnd.google-apps.folder';

export class RecordingDriveFolderService {
  private readonly rootId: string;

  constructor(private readonly client?: RecordingDriveFolderClient, rootId = recordingDriveRootId()) {
    this.rootId = validateDriveFolderId(rootId);
  }

  private requireClient(): RecordingDriveFolderClient {
    if (!this.client) throw new Error('Google Drive authorization/client is not configured.');
    return this.client;
  }

  private async root(): Promise<DriveFolder> {
    const root = await this.requireClient().getFolder(this.rootId);
    if (!root || root.trashed || root.mimeType !== folderMimeType || root.capabilities?.canAddChildren === false) {
      throw new Error('Recording Sessions root folder is missing, inaccessible, or cannot accept folders.');
    }
    return root;
  }

  private directChild(folder: DriveFolder): boolean {
    return folder.mimeType === folderMimeType && !folder.trashed && folder.parents?.includes(this.rootId) === true;
  }

  // A fresh call to this method refreshes names and folders from the client.
  async listDirectChildren(): Promise<DriveFolder[]> {
    await this.root();
    const client = this.requireClient();
    const folders: DriveFolder[] = [];
    const seenTokens = new Set<string>();
    const seenIds = new Set<string>();
    let token: string | undefined;
    do {
      const page = await client.listChildren(this.rootId, token);
      for (const folder of page.files) {
        if (this.directChild(folder) && !seenIds.has(folder.id)) {
          validateDriveFolderId(folder.id);
          seenIds.add(folder.id);
          folders.push(folder);
        }
      }
      token = page.nextPageToken;
      if (token && seenTokens.has(token)) throw new Error('Google Drive returned a repeated folder page.');
      if (token) seenTokens.add(token);
    } while (token);
    return folders;
  }

  async validateDestination(folderId: string): Promise<DriveFolder> {
    validateDriveFolderId(folderId);
    const root = await this.root();
    if (folderId === this.rootId) return root;
    const folder = await this.requireClient().getFolder(folderId);
    if (!folder || !this.directChild(folder)) throw new Error('Selected recording folder is unavailable or outside Recording Sessions.');
    return folder;
  }

  async createDirectChild(name: string): Promise<DriveFolder> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 255 || /[\x00-\x1f\/]/.test(trimmed)) throw new Error('Invalid recording folder name.');
    await this.root();
    const folder = await this.requireClient().createFolder(this.rootId, trimmed);
    if (!this.directChild(folder)) throw new Error('Google Drive did not create the folder inside Recording Sessions.');
    validateDriveFolderId(folder.id);
    return folder;
  }
}
