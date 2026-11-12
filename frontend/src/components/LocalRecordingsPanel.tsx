import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { getStoredUser } from '@/lib/auth';
import { canonicalRecoveredBlob, deleteLocalRecording, listLocalRecordings, unlockLocalRecording, type LocalRecording } from '@/lib/localRecordingStore';
import { RecordingsModal } from './meeting/RecordingsModal';
import type { RecordingPreview } from '@/hooks/useScreenRecorder';
import { repairWebmBlob } from '@/lib/recordingEncoding';
import { fixWebmDuration } from '@fix-webm-duration/fix';
import { useCompanyRecordingUpload } from '@/hooks/useCompanyRecordingUpload';

export default function LocalRecordingsPanel() {
  const [open, setOpen] = useState(false), [owner, setOwner] = useState(''), [entries, setEntries] = useState<LocalRecording[]>([]);
  const [selected, setSelected] = useState(''), [passphrase, setPassphrase] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState<RecordingPreview | null>(null), [meetingCode, setMeetingCode] = useState('');
  const [complete, setComplete] = useState(false);
  const companyUpload = useCompanyRecordingUpload();
  const ownerRef = useRef(''), previewRef = useRef<RecordingPreview | null>(null), epoch = useRef(0);
  const lock = () => {
    epoch.current++; ownerRef.current = ''; setOwner(''); setEntries([]); setSelected(''); setPassphrase(''); setOpen(false); setBusy(false); setMessage(''); setMeetingCode('');
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null; setPreview(null);
  };
  const verifiedOwner = async (expected?: string) => {
    try {
      const result = await trpc.auth.me.query();
      if (!getStoredUser() || getStoredUser()?.id !== result.user.id || (expected && result.user.id !== expected)) throw new Error();
      return result.user.id;
    } catch {
      if (ownerRef.current) lock();
      throw new Error('Your account could not be verified.');
    }
  };
  useEffect(() => {
    let checking = false;
    const check = () => { if (ownerRef.current && getStoredUser()?.id !== ownerRef.current) lock(); };
    const timer = window.setInterval(check, 1000);
    const verify = window.setInterval(() => {
      const current = ownerRef.current;
      if (!current || checking) return;
      checking = true;
      void verifiedOwner(current).catch(() => { if (ownerRef.current === current) lock(); }).finally(() => { checking = false; });
    }, 30000);
    window.addEventListener('storage', check); window.addEventListener('ylaam-session-removed', lock);
    return () => { epoch.current++; window.clearInterval(timer); window.clearInterval(verify); window.removeEventListener('storage', check); window.removeEventListener('ylaam-session-removed', lock); if (previewRef.current) URL.revokeObjectURL(previewRef.current.url); previewRef.current = null; };
  }, []);
  const show = async () => {
    if (open) { lock(); return; }
    const current = ++epoch.current; setBusy(true); setMessage('');
    try {
      const id = await verifiedOwner();
      const rows = await listLocalRecordings(id);
      if (epoch.current !== current || getStoredUser()?.id !== id) return;
      ownerRef.current = id; setOwner(id); setEntries(rows); setOpen(true);
    } catch { if (epoch.current === current) setMessage('Local recordings are unavailable. Verify your session and browser storage, then retry.'); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  const unlock = async () => {
    if (!owner || !selected || !passphrase || busy) return;
    const current = epoch.current; setBusy(true); setMessage('');
    try {
      await verifiedOwner(owner);
      const result = await unlockLocalRecording(owner, selected, passphrase);
      await verifiedOwner(owner);
      if (epoch.current !== current || getStoredUser()?.id !== owner) return;
      const blob = result.blob.type === 'video/webm' && result.record.state === 'complete'
        ? await repairWebmBlob(result.blob, result.details.durationSeconds * 1000, (value, duration) => fixWebmDuration(value, duration, { logger: false })) : result.blob;
      if (epoch.current !== current || getStoredUser()?.id !== owner) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
      const next = { blob, recordingId: result.details.uploadRecordingId ?? result.record.id, recordingStartedAt:result.details.recordingStartedAt, canonicalBlob: canonicalRecoveredBlob(result.record, result.details, result.blob), url: URL.createObjectURL(blob), fileName: result.details.fileName, mimeType: result.details.mimeType, durationSeconds: result.details.durationSeconds, occurrenceId: result.details.occurrenceId };
      previewRef.current = next; setMeetingCode(result.details.meetingCode); setComplete(result.record.state === 'complete'); setPreview(next); setPassphrase('');
      if (result.record.state !== 'complete') setMessage('This recording was interrupted or storage failed. Playback may be incomplete.');
    } catch (error) { if (epoch.current === current) setMessage(error instanceof Error ? error.message : 'Unable to unlock recording.'); }
    finally { if (epoch.current === current) { setBusy(false); setPassphrase(''); } }
  };
  const remove = async (id: string) => {
    if (!owner || busy || !window.confirm('Permanently delete this local recording and its saved chunks from this browser?')) return;
    const current = epoch.current; setBusy(true);
    try {
      await verifiedOwner(owner);
      if (epoch.current !== current || getStoredUser()?.id !== owner) return;
      await deleteLocalRecording(owner, id);
      if (epoch.current !== current) return;
      setEntries(await listLocalRecordings(owner)); setSelected(''); setMessage('Local recording deleted.');
    } catch { if (epoch.current === current) setMessage('Could not delete this recording. Please retry.'); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  return <section aria-label="Local Recordings" className="space-y-3 rounded-[8px] border border-slate-200 p-4">
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => void show()} className="rounded-[8px] border border-slate-200 px-3 py-2 font-semibold">{open ? 'Hide Local Recordings' : 'Local Recordings'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
    {open && <>
      <p className="text-sm text-slate-500">Encrypted recordings belong to this browser profile. Clearing browser data removes them. A forgotten passphrase cannot be recovered.</p>
      {!entries.length && <p className="text-sm">No local recordings for this account.</p>}
      <ul className="space-y-2">{entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-slate-200 p-3 text-sm">
        <span className="flex-1">{new Date(entry.createdAt).toLocaleString()} · {entry.id.slice(-8)} · {entry.state === 'complete' ? 'Complete' : entry.state === 'storage-failed' ? 'Storage failed' : 'Incomplete'} · {entry.bytes} bytes</span>
        <button type="button" disabled={busy} onClick={() => { setSelected(entry.id); setPassphrase(''); setMessage(''); }} className="rounded-[8px] border border-slate-200 px-3 py-2">Unlock</button>
        <button type="button" disabled={busy} onClick={() => void remove(entry.id)} className="rounded-[8px] border border-slate-200 px-3 py-2">Delete</button>
      </li>)}</ul>
      {selected && <div className="space-y-2 rounded-[8px] border border-slate-200 p-3">
        <label className="block text-sm">Recovery passphrase<input type="password" autoComplete="off" value={passphrase} onChange={event => setPassphrase(event.target.value)} className="mt-1 w-full rounded-[8px] border border-slate-200 bg-white p-2" /></label>
        <button disabled={busy || !passphrase} onClick={() => void unlock()} className="rounded-[8px] bg-blue-600 px-3 py-2 text-white disabled:opacity-50">Review recording</button>
      </div>}
    </>}
    {preview && <RecordingsModal isOpen localRecovery allowUpload={complete} meetingCode={meetingCode} preview={preview}
      companyUploads={companyUpload.statuses} onCompanyRetry={companyUpload.retry}
      onCompanyUpload={owner && preview.canonicalBlob && !companyUpload.statuses.some(status => status.recordingId === preview.recordingId)
        ? () => { void companyUpload.start(preview, meetingCode, owner, true); } : undefined}
      onClose={() => { if (previewRef.current) URL.revokeObjectURL(previewRef.current.url); previewRef.current = null; setPreview(null); }} onDiscardPreview={() => { if (previewRef.current) URL.revokeObjectURL(previewRef.current.url); previewRef.current = null; setPreview(null); }} />}
  </section>;
}
