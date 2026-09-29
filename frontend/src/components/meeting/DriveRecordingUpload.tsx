import { useEffect, useRef, useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import type { RecordingPreview } from '@/hooks/useScreenRecorder';
import { trpc } from '@/lib/trpc';
import { checkDriveFolder, connectDrive, driveFolderId, loadDrive, newDriveUpload, pickDriveFolder, uploadRecordingToDrive,
  type DriveConnection, type DriveUpload } from '@/lib/googleDriveRecording';
const config = { clientId: import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || '', apiKey: import.meta.env.VITE_GOOGLE_DRIVE_API_KEY || '', appId: import.meta.env.VITE_GOOGLE_DRIVE_APP_ID || '' };
const configured = Boolean(config.clientId && config.apiKey && config.appId);

export function DriveRecordingUpload({ preview, meetingCode, disabled, onBusyChange }: {
  preview: RecordingPreview; meetingCode: string; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<DriveConnection | null>(null);
  const [folderLink, setFolderLink] = useState(''), [folderName, setFolderName] = useState('');
  const [message, setMessage] = useState(''), [progress, setProgress] = useState<number | null>(null), [url, setUrl] = useState('');
  const lock = useRef(false), attempt = useRef<DriveUpload | null>(null);
  const load = () => { setMessage(''); void loadDrive().then(() => setReady(true)).catch(error => setMessage(error.message)); };
  useEffect(() => { if (expanded && configured && !ready) load(); }, [expanded]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusyChange(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to upload to Google Drive.'); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  };
  const connect = () => run(async () => {
    const next = await connectDrive(config);
    if (connection && next.accountId !== connection.accountId) {
      attempt.current = null; setFolderLink(''); setFolderName(''); setProgress(null); setUrl('');
    }
    setConnection(next);
  });
  const selectFolder = () => run(async () => {
    const selected = await pickDriveFolder(config, connection!);
    if (selected) {
      const folder = await checkDriveFolder(connection!, selected.id);
      setFolderLink(`https://drive.google.com/drive/folders/${folder.id}`); setFolderName(folder.name); attempt.current = null; setProgress(null);
    }
  });
  const upload = () => run(async () => {
    await trpc.recordings.authorizeExport.mutate({ meetingCode, occurrenceId: preview.occurrenceId });
    const folder = await checkDriveFolder(connection!, driveFolderId(folderLink)); setFolderName(folder.name);
    attempt.current ??= await newDriveUpload(connection!);
    setProgress(0);
    const result = await uploadRecordingToDrive(connection!, folder.id, preview, attempt.current, setProgress);
    setUrl(result); setMessage('Recording uploaded to Google Drive. Your local preview is still available.');
  });
  return <>
    <button type="button" disabled={disabled || busy} onClick={() => setExpanded(value => !value)} aria-expanded={expanded}
      className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60">
      <CloudUpload className="h-4 w-4" /> {url ? 'Uploaded to Google Drive' : 'Upload to Google Drive'}
    </button>
    {expanded && <div className="order-last basis-full space-y-3 rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-700">
      <h4 className="font-semibold">Google Drive destination</h4>
      {!configured ? <p>Google Drive upload needs setup by your administrator. Download and Supabase upload are available independently.</p> : <>
        {!ready && <button disabled={busy || disabled} className="underline" onClick={load}>Load / retry Google Drive connection</button>}
        {ready && <button disabled={busy || disabled || Boolean(url)} className="rounded-lg border px-3 py-2 disabled:opacity-50" onClick={() => void connect()}>
          {connection ? `Reconnect Google Drive (${connection.email})` : 'Connect Google Drive'}
        </button>}
        {connection && !url && <>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || disabled || Boolean(attempt.current)} onClick={() => void selectFolder()} className="rounded-lg border px-3 py-2">Choose folder</button>
            <label className="flex min-w-0 flex-1 flex-col gap-1">Or paste a Drive folder link
              <input type="url" value={folderLink} disabled={busy || disabled || Boolean(attempt.current)} placeholder="https://drive.google.com/drive/folders/..."
                onChange={event => { setFolderLink(event.target.value); setFolderName(''); }} className="w-full rounded-lg border px-3 py-2" />
            </label>
          </div>
          <p className="text-xs text-slate-500">Use Choose folder the first time to grant YLAAM Meet access. Your Google account needs upload permission. Existing folder sharing determines who can view the recording.</p>
          {folderName && <p>Folder: <strong>{folderName}</strong></p>}
          <button disabled={busy || disabled || !folderLink.trim()} onClick={() => void upload()} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {busy ? 'Working...' : attempt.current ? 'Retry / resume upload' : 'Upload recording to this folder'}
          </button>
        </>}
        {busy && <Loader2 aria-label="Google Drive operation in progress" className="inline h-4 w-4 animate-spin" />}
        {progress !== null && <div><progress max={100} value={progress} className="w-full" aria-label="Drive upload progress" /><p>{progress}% uploaded</p></div>}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block font-semibold text-emerald-700 underline">Open recording in Google Drive</a>}
      </>}
      {message && <p role="status">{message}</p>}
    </div>}
  </>;
}
