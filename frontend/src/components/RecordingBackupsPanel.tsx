import { useEffect, useRef, useState } from 'react';
import { getStoredUser, subscribeToSessionRemoval } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { listRecordingBackups, reconstructRecordingBackup, type BackupMetadata } from '@/lib/recordingBackup';
import { RecordingsModal } from './meeting/RecordingsModal';
import { useCompanyRecordingUpload } from '@/hooks/useCompanyRecordingUpload';
import type { RecordingPreview } from '@/hooks/useScreenRecorder';
import { reconcileConfirmedBackup } from '@/lib/recordingBackupCleanup';

export default function RecordingBackupsPanel() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<BackupMetadata[]>([]), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ url: string; entry: BackupMetadata; partial: boolean; blob: Blob } | null>(null);
  const [playable, setPlayable] = useState(false), [uploadOpen, setUploadOpen] = useState(false);
  const [savedFolderId, setSavedFolderId] = useState<string | null>(null);
  const companyUpload = useCompanyRecordingUpload();
  const epoch = useRef(0), owner = useRef(''), url = useRef('');
  const lock = () => {
    epoch.current++; owner.current = ''; setOpen(false); setEntries([]); setPreview(null); setMessage(''); setBusy(false); setPlayable(false); setUploadOpen(false); setSavedFolderId(null);
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
  };
  const verifyOwner = async (expected?: string) => {
    const { user } = await trpc.auth.me.query();
    if (!user.id || getStoredUser()?.id !== user.id || (expected && expected !== user.id)) throw new Error('Your account could not be verified.');
    return user.id;
  };
  useEffect(() => {
    let checking = false;
    const check = () => { if (owner.current && getStoredUser()?.id !== owner.current) lock(); };
    const unsubscribe = subscribeToSessionRemoval(lock);
    const timer = window.setInterval(check, 1000);
    const verify = window.setInterval(() => {
      const current = owner.current;
      if (!current || checking) return;
      checking = true;
      void verifyOwner(current).catch(() => { if (owner.current === current) lock(); }).finally(() => { checking = false; });
    }, 30000);
    window.addEventListener('storage', check);
    return () => { epoch.current++; unsubscribe(); window.clearInterval(timer); window.clearInterval(verify); window.removeEventListener('storage', check); if (url.current) URL.revokeObjectURL(url.current); };
  }, []);
  const show = async () => {
    if (open) { lock(); return; }
    const current = ++epoch.current; setBusy(true); setMessage('');
    try {
      const id = await verifyOwner();
      const initial = await listRecordingBackups(id);
      await Promise.all(initial.map(row => reconcileConfirmedBackup(id, row.id)));
      const rows = await listRecordingBackups(id);
      // Local metadata alone does not establish meeting or occurrence access.
      const authorized = await Promise.all(rows.map(async row => {
        try {
          await trpc.recordings.authorizeExport.mutate({ meetingCode: row.meetingCode, occurrenceId: row.occurrenceId });
          return row;
        } catch { return null; }
      }));
      await verifyOwner(id);
      if (epoch.current !== current) return;
      owner.current = id; setEntries(authorized.filter((row): row is BackupMetadata => row !== null)); setOpen(true);
    } catch { if (epoch.current === current) setMessage('Unable to verify your account or browser backups. Check your connection and retry.'); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  const review = async (entry: BackupMetadata) => {
    if (!owner.current || busy) return;
    const id = owner.current, current = epoch.current; setBusy(true); setMessage('');
    try {
      await verifyOwner(id);
      await trpc.recordings.authorizeExport.mutate({ meetingCode: entry.meetingCode, occurrenceId: entry.occurrenceId });
      const result = await reconstructRecordingBackup(id, entry.id);
      await verifyOwner(id);
      if (epoch.current !== current || getStoredUser()?.id !== id) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(result.blob);
      setPlayable(false); setUploadOpen(false); setPreview({ url: url.current, entry: result.metadata, partial: result.partial, blob: result.blob });
      if (result.partial) setMessage('Interrupted recording: the available data may be incomplete or unplayable.');
    } catch { if (epoch.current === current) setMessage('This backup could not be verified or contains missing or damaged chunks. It has been retained.'); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  const openUpload = async () => {
    if (!preview || preview.partial || !playable || !owner.current || busy) return;
    const id = owner.current, current = epoch.current; setBusy(true); setMessage('');
    try {
      await verifyOwner(id);
      await trpc.recordings.authorizeExport.mutate({ meetingCode: preview.entry.meetingCode, occurrenceId: preview.entry.occurrenceId });
      const { meeting } = await trpc.meetings.getByCode.query({ meetingCode: preview.entry.meetingCode, occurrenceId: preview.entry.occurrenceId });
      if (!preview.entry.meetingId || meeting.id !== preview.entry.meetingId) throw new Error('Meeting identity could not be verified.');
      await verifyOwner(id);
      if (epoch.current !== current || getStoredUser()?.id !== id) return;
      setSavedFolderId(meeting.recordingFolderId ?? null); setUploadOpen(true);
    } catch { if (epoch.current === current) setMessage('The meeting or recording authorization could not be verified. The backup has been retained.'); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  const recordingPreview: RecordingPreview | null = preview && !preview.partial && playable ? {
    blob: preview.blob, canonicalBlob: preview.blob, url: preview.url, recordingId: preview.entry.id,
    recordingStartedAt: preview.entry.startedAt, fileName: preview.entry.fileName, mimeType: preview.entry.mimeType,
    durationSeconds: preview.entry.durationSeconds, occurrenceId: preview.entry.occurrenceId,
  } : null;
  return <section aria-label="Recover Recordings" className="space-y-3 rounded-[8px] border border-slate-200 p-4">
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => void show()} className="rounded-[8px] border border-slate-200 px-3 py-2 font-semibold">{open ? 'Hide Recover Recordings' : 'Recover Recordings'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
    {open && <>
      <p className="text-sm text-slate-500">Browser backups are unencrypted and belong to this browser profile. Clearing site data or browser eviction can remove them.</p>
      {!entries.length && <p className="text-sm">No authorized browser backups are available.</p>}
      <ul className="space-y-2">{entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-slate-200 p-3 text-sm">
        <span className="flex-1">{entry.meetingName} · {new Date(entry.startedAt).toLocaleString()} · {entry.durationSeconds ? `${entry.durationSeconds}s` : 'Duration unavailable'} · {entry.bytes} bytes · {entry.state === 'complete' ? 'Complete' : 'Interrupted or incomplete'}</span>
        <button disabled={busy} type="button" onClick={() => void review(entry)} className="rounded-[8px] border border-slate-200 px-3 py-2">Review backup</button>
      </li>)}</ul>
      {preview && <div className="space-y-2">
        <p className="text-sm">{preview.partial ? 'Partial recording — playback is not guaranteed.' : 'Completed browser backup.'}</p>
        <video controls src={preview.url} onCanPlay={() => setPlayable(true)} onError={() => { setPlayable(false); setMessage('This backup is not playable in this browser. The saved chunks have been retained.'); }} className="max-h-80 w-full" />
        <a className="inline-block rounded-[8px] border border-slate-200 px-3 py-2" href={preview.url} download={preview.entry.fileName}>Download backup</a>
        {!preview.partial && <button disabled={!playable || busy} type="button" onClick={() => void openUpload()} className="ml-2 rounded-[8px] border border-slate-200 px-3 py-2 disabled:opacity-50">Open upload review</button>}
        {preview.partial && <p className="text-sm text-slate-500">Interrupted backups cannot yet be safely finalized for upload. The backup will be retained.</p>}
      </div>}
    </>}
    {preview && recordingPreview && <RecordingsModal isOpen={uploadOpen} localRecovery allowUpload meetingCode={preview.entry.meetingCode} preview={recordingPreview}
      savedFolderId={savedFolderId} companyUploads={companyUpload.statuses} onCompanyRetry={companyUpload.retry}
      onCompanyUpload={(folderId) => { if (owner.current && recordingPreview) return companyUpload.start(recordingPreview, preview.entry.meetingCode, owner.current, false, folderId).then(() => {}); }}
      onClose={() => setUploadOpen(false)} onDiscardPreview={() => setUploadOpen(false)} />}
  </section>;
}
