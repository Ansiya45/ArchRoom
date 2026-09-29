// Google credentials are short-lived and held in memory only. Recordings go
// directly from the browser to Drive; no Google tokens reach the YLAAM backend.
export type DriveConfig = { clientId: string; apiKey: string; appId: string };
export type DriveConnection = { token: string; expiresAt: number; accountId: string; email: string };
export type DriveUpload = { fileId: string; sessionUrl?: string; complete?: boolean };
const scope = 'https://www.googleapis.com/auth/drive.file';
const api = 'https://www.googleapis.com/drive/v3';
const sdk = () => window as unknown as { google: any; gapi: any };
let loading: Promise<void> | undefined;
function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script'); tag.src = src; tag.async = true;
    const timer = setTimeout(() => { tag.remove(); reject(new Error('Google did not load. Check your connection and retry.')); }, 20000);
    tag.onload = () => { clearTimeout(timer); resolve(); };
    tag.onerror = () => { clearTimeout(timer); tag.remove(); reject(new Error('Unable to load Google Drive.')); };
    document.head.appendChild(tag);
  });
}
export function loadDrive() {
  loading ??= Promise.all([
    sdk().google?.accounts ? Promise.resolve() : script('https://accounts.google.com/gsi/client'),
    sdk().gapi ? Promise.resolve() : script('https://apis.google.com/js/api.js'),
  ]).then(() => new Promise<void>((resolve, reject) => sdk().gapi.load('picker', {
    callback: resolve, onerror: () => reject(new Error('Unable to load the Drive folder picker.')),
    timeout: 20000, ontimeout: () => reject(new Error('Drive folder picker timed out.')),
  }))).catch(error => { loading = undefined; throw error; });
  return loading;
}
function headers(connection: DriveConnection) {
  if (Date.now() >= connection.expiresAt) throw new Error('Google access expired. Reconnect Google Drive, then retry the upload.');
  return { Authorization: `Bearer ${connection.token}` };
}
async function check(response: Response) {
  if (response.ok) return;
  if (response.status === 401) throw new Error('Google access expired. Reconnect Google Drive, then retry.');
  if (response.status === 403 || response.status === 404) throw new Error('Drive access was denied. Check folder permissions/storage quota, or choose the folder using the picker.');
  throw new Error(`Google Drive request failed (${response.status}). Please retry.`);
}
export function connectDrive(config: DriveConfig): Promise<DriveConnection> {
  // Must be invoked directly by a click, after loadDrive() has completed.
  return new Promise((resolve, reject) => {
    const client = sdk().google.accounts.oauth2.initTokenClient({
      client_id: config.clientId, scope, include_granted_scopes: false,
      callback: async (response: { access_token?: string; expires_in?: number; error?: string }) => {
        if (response.error || !response.access_token || !sdk().google.accounts.oauth2.hasGrantedAllScopes(response, scope)) {
          reject(new Error('Google Drive access was not granted.')); return;
        }
        const connection = { token: response.access_token, expiresAt: Date.now() + (Number(response.expires_in || 3600) - 60) * 1000, accountId: '', email: '' };
        try {
          const result = await fetch(`${api}/about?fields=user(permissionId,emailAddress)`, { headers: headers(connection), signal: AbortSignal.timeout(20000) });
          await check(result); const data = await result.json();
          connection.accountId = data.user.permissionId; connection.email = data.user.emailAddress;
          resolve(connection);
        } catch (error) { reject(error); }
      },
      error_callback: () => reject(new Error('Google connection was cancelled or the popup was blocked. Please try again.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}
export function pickDriveFolder(config: DriveConfig, connection: DriveConnection): Promise<{ id: string; name: string } | null> {
  headers(connection);
  return new Promise(resolve => {
    const pickerApi = sdk().google.picker;
    const view = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new pickerApi.PickerBuilder().addView(view).setOAuthToken(connection.token)
      .setDeveloperKey(config.apiKey).setAppId(config.appId).setOrigin(window.location.origin)
      .setTitle('Choose a folder for class recordings')
      .setCallback((data: any) => {
        if (data.action === pickerApi.Action.PICKED) { picker.dispose(); resolve({ id: data.docs[0].id, name: data.docs[0].name }); }
        if (data.action === pickerApi.Action.CANCEL) { picker.dispose(); resolve(null); }
      }).build();
    picker.setVisible(true);
  });
}
export function driveFolderId(link: string) {
  const value = link.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') throw new Error();
    const id = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
    if (id) return id;
  } catch { /* Give the same clear error for all invalid links. */ }
  throw new Error('Paste a Google Drive folder link, not a recording/file link.');
}
export async function checkDriveFolder(connection: DriveConnection, id: string) {
  const result = await fetch(`${api}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,capabilities(canAddChildren),trashed&supportsAllDrives=true`, { headers: headers(connection), signal: AbortSignal.timeout(20000) });
  await check(result); const folder = await result.json();
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities?.canAddChildren) {
    throw new Error('Choose a folder where your connected Google account can upload files.');
  }
  return { id: folder.id as string, name: folder.name as string };
}
export async function newDriveUpload(connection: DriveConnection): Promise<DriveUpload> {
  const result = await fetch(`${api}/files/generateIds?count=1&space=drive&type=files`, { headers: headers(connection), signal: AbortSignal.timeout(20000) });
  await check(result); const data = await result.json(); return { fileId: data.ids[0] };
}
function uploadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/upload/drive/')) throw new Error('Google returned an invalid upload location.');
  return value;
}
export async function uploadRecordingToDrive(connection: DriveConnection, folderId: string,
  recording: { blob: Blob; fileName: string; mimeType: string }, attempt: DriveUpload, progress: (percent: number) => void) {
  if (attempt.complete) return `https://drive.google.com/file/d/${attempt.fileId}/view`;
  if (!recording.blob.size) throw new Error('The recording is empty.');
  const auth = headers(connection), total = recording.blob.size;
  const mime = recording.mimeType.split(';')[0] || 'video/webm';
  let offset = 0;
  const completed = () => { attempt.complete = true; progress(100); return `https://drive.google.com/file/d/${attempt.fileId}/view`; };
  const status = async () => fetch(uploadUrl(attempt.sessionUrl!), { method: 'PUT', headers: { ...headers(connection), 'Content-Range': `bytes */${total}` }, signal: AbortSignal.timeout(60000) });
  const acknowledged = (response: Response) => {
    const range = response.headers.get('Range');
    if (!range) return 0;
    const match = /^bytes=0-(\d+)$/.exec(range);
    if (!match || Number(match[1]) >= total) throw new Error('Google returned an invalid upload offset.');
    return Number(match[1]) + 1;
  };
  if (attempt.sessionUrl) {
    const response = await status();
    if (response.ok) return completed();
    if (response.status === 308) offset = acknowledged(response);
    else if (response.status === 404 || response.status === 410) attempt.sessionUrl = undefined;
    else await check(response);
  }
  if (!attempt.sessionUrl) {
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(total) },
      body: JSON.stringify({ id: attempt.fileId, name: recording.fileName, parents: [folderId] }), signal: AbortSignal.timeout(30000),
    });
    if (response.status === 409) {
      // The final response may have been lost. Only report success for a complete,
      // matching file; reuse the generated ID to prevent duplicate recordings.
      const existing = await fetch(`${api}/files/${attempt.fileId}?fields=id,size,parents&supportsAllDrives=true`, { headers: auth, signal: AbortSignal.timeout(20000) });
      await check(existing); const file = await existing.json();
      if (Number(file.size) === total && file.parents?.includes(folderId)) return completed();
      throw new Error('A conflicting Drive upload exists. Download the original recording and check Drive before retrying.');
    }
    await check(response);
    const location = response.headers.get('Location');
    if (!location) throw new Error('Google did not return an upload location. Please retry.');
    attempt.sessionUrl = uploadUrl(location);
  }
  let retries = 0;
  while (offset < total) {
    const end = Math.min(offset + 8 * 1024 * 1024, total);
    let response: Response;
    try {
      response = await fetch(uploadUrl(attempt.sessionUrl!), { method: 'PUT', headers: { ...headers(connection), 'Content-Type': mime, 'Content-Range': `bytes ${offset}-${end - 1}/${total}` }, body: recording.blob.slice(offset, end), signal: AbortSignal.timeout(120000) });
      if (response.status >= 500 || response.status === 429) throw new Error('Temporary Drive failure');
    } catch (error) {
      if (++retries > 3) throw new Error('Drive upload paused after a network error. Keep this page open and retry to resume.');
      await new Promise(resolve => setTimeout(resolve, retries * 1000));
      response = await status();
    }
    if (response.ok) return completed();
    if (response.status !== 308) { await check(response); throw new Error('Drive upload could not continue.'); }
    const next = acknowledged(response);
    if (next <= offset && ++retries > 3) throw new Error('Drive upload made no progress. Please retry.');
    if (next > offset) retries = 0;
    offset = next; progress(Math.floor(offset / total * 100));
  }
  throw new Error('Google did not confirm the upload. Retry to check its status.');
}
