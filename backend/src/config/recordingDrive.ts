// EDIT ONLY THIS URL to change the central recording root.
export const RECORDINGS_DRIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1Txkb851QSUC4rsvhCNrpd2X_Pu3q36Xw?usp=drive_link";

const folderIdPattern = /^[A-Za-z0-9_-]{10,128}$/;

export function validateDriveFolderId(value: string): string {
  if (!folderIdPattern.test(value)) throw new Error('Invalid Google Drive folder ID.');
  return value;
}

export function folderIdFromDriveUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid Google Drive folder URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.port || url.username || url.password || url.hash) {
    throw new Error('Invalid Google Drive folder URL.');
  }
  const match = /^\/drive\/folders\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (!match || [...url.searchParams.keys()].some(key => key !== 'usp')) throw new Error('Unsupported Google Drive folder URL.');
  return validateDriveFolderId(match[1]);
}

export function recordingDriveRootId(): string {
  return folderIdFromDriveUrl(RECORDINGS_DRIVE_FOLDER_URL);
}
