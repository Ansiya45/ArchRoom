import { useEffect, useId, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import { getStoredUser } from '../lib/auth';
import BatchRegistrationLinks from './BatchRegistrationLinks';

type Students = Awaited<ReturnType<typeof trpc.recordingFolders.listStudents.query>>['students'];
const control = 'rounded-[8px] border border-slate-200 px-3 py-2 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:opacity-50';

export default function BatchStudents({ folderId, folderName }: { folderId: string; folderName: string }) {
  const id = useId();
  const owner = useRef(getStoredUser()?.id);
  const epoch = useRef(0), working = useRef(false);
  const [allowed, setAllowed] = useState(false), [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [students, setStudents] = useState<Students>([]);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null), emailInput = useRef<HTMLInputElement>(null);
  const sameOwner = () => Boolean(owner.current && getStoredUser()?.id === owner.current);
  const clear = () => { setAllowed(false); setStudents([]); setOpen(false); setName(''); setEmail(''); setRemoving(null); setMessage(''); };

  const load = async (current: number) => {
    const result = await trpc.recordingFolders.listStudents.query({ folderId });
    if (epoch.current !== current || !sameOwner()) return false;
    setStudents(result.students); setAllowed(true); return true;
  };
  const failed = (cause: unknown, previouslyAllowed = false) => {
    const code = (cause as { data?: { code?: string } })?.data?.code;
    clear();
    setError(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].includes(code ?? '')
      ? previouslyAllowed ? 'Student management access is no longer available. The student list has been cleared.' : ''
      : 'Student management is unavailable. Please retry.');
  };
  const refresh = async () => {
    if (working.current || !sameOwner()) return;
    working.current = true; setBusy(true); setError('');
    const current = ++epoch.current;
    try { await load(current); }
    catch (cause) { if (epoch.current === current && sameOwner()) failed(cause, allowed); }
    finally { if (epoch.current === current) { working.current = false; setBusy(false); } }
  };
  useEffect(() => {
    working.current = false;
    void refresh();
    const check = () => {
      if (!sameOwner()) { epoch.current++; working.current = false; clear(); setError(''); setBusy(false); }
    };
    window.addEventListener('storage', check); window.addEventListener('ylaam-session-removed', check);
    const timer = window.setInterval(check, 1000);
    return () => { epoch.current++; working.current = false; window.clearInterval(timer); window.removeEventListener('storage', check); window.removeEventListener('ylaam-session-removed', check); };
  }, []);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (!allowed || working.current || !sameOwner()) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    const current = ++epoch.current;
    try {
      await operation();
      if (epoch.current !== current || !sameOwner()) return;
      setName(''); setEmail(''); setRemoving(null);
      if (await load(current)) setMessage(success);
    } catch (cause) {
      if (epoch.current !== current || !sameOwner()) return;
      // Hide cached private data after an error; a fresh authorized list is required.
      failed(cause, true);
    } finally { if (epoch.current === current) { working.current = false; setBusy(false); } }
  };
  const add = () => {
    if (!nameInput.current?.reportValidity() || !emailInput.current?.reportValidity()) return;
    void mutate(() => trpc.recordingFolders.addStudent.mutate({ folderId, name: name.trim(), email: email.trim() }), 'Student list updated.');
  };
  const date = (value: string | Date | null) => value ? new Date(value).toLocaleString() : '—';

  return <div className="space-y-2">
    {busy && !allowed && <p role="status" className="text-xs text-slate-500">Checking student management access…</p>}
    {error && <div role="alert" className="text-xs text-slate-500">{error} <button type="button" disabled={busy} className={control} onClick={() => void refresh()}>Retry student access</button></div>}
    {allowed && <>
      <button type="button" aria-expanded={open} aria-controls={id} className={control} onClick={() => setOpen(value => !value)}>{open ? 'Hide Students' : 'Students'}</button>
      {open && <section id={id} aria-label={`Students — ${folderName}`} aria-busy={busy} className="space-y-3 rounded-[8px] border border-slate-200 p-3">
        <h5 className="text-sm font-semibold text-white">Students — {folderName}</h5>
        <p className="text-xs text-slate-500">Enrollment does not verify a Google account or grant recording or Google Drive access.</p>
        <BatchRegistrationLinks folderId={folderId} onDenied={() => { clear(); setError('Student management access is no longer available.'); }} />
        <div className="grid gap-2 sm:grid-cols-2" onKeyDown={event => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); add(); }
        }}>
          {/* Detach from the surrounding meeting form: student fields must never block or submit a meeting. */}
          <label className="text-xs text-slate-500">Student name<input ref={nameInput} form={`${id}-student-fields`} required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} className={`${control} mt-1 w-full bg-slate-50`} /></label>
          <label className="text-xs text-slate-500">Student email<input ref={emailInput} form={`${id}-student-fields`} type="email" required maxLength={255} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} className={`${control} mt-1 w-full bg-slate-50`} /></label>
          <button type="button" disabled={busy || !name.trim() || !email.trim()} onClick={add} className={`${control} bg-purple-600 sm:col-span-2`}>Add Student</button>
        </div>
        <button type="button" disabled={busy} className={control} onClick={() => void refresh()}>Refresh students</button>
        {busy && <p role="status" className="text-xs text-slate-500">Updating students…</p>}
        {message && <p role="status" className="text-xs text-slate-500">{message}</p>}
        {!students.length && <p className="text-xs text-slate-500">No students enrolled in this batch.</p>}
        <ul className="space-y-2">{students.map(student => <li key={student.id} className="space-y-2 rounded-[8px] border border-slate-200 p-3">
          <p className="break-words font-medium text-white">{student.studentName}</p>
          <p className="break-all text-xs text-slate-500">{student.studentEmail}</p>
          <p className="text-xs text-slate-500">{student.emailVerifiedAt ? `Email verified: ${date(student.emailVerifiedAt)}` : student.source === 'registration' ? 'Email submitted — awaiting verification' : 'Manually added — email not verified'} · Google identity not verified</p>
          <p className="text-xs text-slate-500">Status: {student.status} · Added: {date(student.createdAt)} · Updated: {date(student.updatedAt)}{student.removedAt ? ` · Removed: ${date(student.removedAt)}` : ''}</p>
          <div className="flex flex-wrap gap-2">
            {student.status !== 'approved' && <button type="button" disabled={busy || (student.source === 'registration' && !student.emailVerifiedAt)} className={control} onClick={() => void mutate(() => trpc.recordingFolders.approveStudent.mutate({ folderId, enrollmentId: student.id }), 'Enrollment approved.')}>{student.status === 'removed' ? 'Reapprove' : 'Approve'}</button>}
            {student.status === 'approved' && <button type="button" disabled={busy} className={control} onClick={() => setRemoving(student.id)}>Remove</button>}
          </div>
          {removing === student.id && <div role="group" aria-label={`Confirm removal of ${student.studentName}`} className="space-y-2 rounded-[8px] border border-slate-200 p-2">
            <p className="text-xs text-slate-500">Remove this student from approved enrollment? This does not revoke any existing Google Drive permissions.</p>
            <div className="flex gap-2"><button type="button" disabled={busy} className={control} onClick={() => void mutate(() => trpc.recordingFolders.removeStudent.mutate({ folderId, enrollmentId: student.id }), 'Enrollment removed.')}>Confirm removal</button>
              <button type="button" disabled={busy} className={control} onClick={() => setRemoving(null)}>Cancel</button></div>
          </div>}
        </li>)}</ul>
      </section>}
    </>}
  </div>;
}
