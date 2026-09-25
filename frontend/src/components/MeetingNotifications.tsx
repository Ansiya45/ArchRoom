import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import type { MeetingRecord } from '../lib/meetingSchedule';
import { getStoredUser } from '../lib/auth';
import { MeetingCalendarLinks } from './MeetingCalendarLinks';
type Info = Awaited<ReturnType<typeof trpc.meetingNotifications.info.query>>;
export function MeetingNotifications({ meeting }: { meeting: MeetingRecord }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const action = async (fn: () => Promise<void>) => {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update meeting notifications.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const refresh = async () => setInfo(await trpc.meetingNotifications.info.query({ meetingId: meeting.id }));
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    trpc.meetingNotifications.info.query({ meetingId: meeting.id }).then(value => { if (!cancelled) setInfo(value); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load notifications.'); });
    return () => { cancelled = true; };
  }, [meeting.id, meeting.updatedAt, open]);
  const email = getStoredUser()?.email.toLowerCase();
  const own = info?.invitations.find(row => row.email === email);
  return <div className="text-sm space-y-3 border-t border-slate-100 pt-3">
    <button type="button" className="text-blue-600 font-semibold" disabled={busy} onClick={() => setOpen(!open)}>Calendar, invitations & reminders</button>
    {open && <>
      {busy && <p className="text-xs text-slate-500">Loading...</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {message && <p role="status" className="text-xs text-green-700">{message}</p>}
      {info && <>
        <MeetingCalendarLinks calendar={info.calendar} />
        {!info.emailConfigured && <p className="text-xs text-slate-500">Email invitations and reminders are not configured yet.</p>}
        <label className="block text-xs font-semibold">Invite by email
          <textarea className="mt-1 w-full rounded-xl border border-slate-200 p-2 font-normal" placeholder="name@example.com, teammate@example.com" value={emails} onChange={e => setEmails(e.target.value)} disabled={busy || !info.emailConfigured} />
        </label>
        <button type="button" className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={busy || !info.emailConfigured || !emails.trim() || (meeting.status === 'ended' || !!meeting.recurrenceCancelledAt)} onClick={() => void action(async () => {
          const result = await trpc.meetingNotifications.invite.mutate({ meetingId: meeting.id, emails: emails.split(/[,;\s]+/).filter(Boolean) });
          setEmails(''); await refresh(); setMessage(result.message);
        })}>Send invitations</button>
        <p className="text-xs text-slate-500">Invitees choose whether to receive email reminders. Invitations never bypass the waiting room.</p>
        {meeting.scheduledAt && meeting.scheduleType !== 'reusable' && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={own?.remindersEnabled || false} disabled={busy || (!own?.remindersEnabled && (!info.emailConfigured || (meeting.status === 'ended' || !!meeting.recurrenceCancelledAt)))} onChange={e => { const enabled = e.target.checked; void action(async () => { await trpc.meetingNotifications.myReminder.mutate({ meetingId: meeting.id, enabled }); await refresh(); }); }} />Email me 10 minutes before each scheduled occurrence</label>}
        {info.invitations.map(invitation => <div key={invitation.id} className="text-xs text-slate-500 break-all">{invitation.email} - reminders {invitation.remindersEnabled ? 'on' : 'off'}{info.deliveries.find(d => d.invitationId === invitation.id && d.kind === 'invitation') ? ` - invitation ${info.deliveries.find(d => d.invitationId === invitation.id && d.kind === 'invitation')!.status}` : ''}</div>)}
        <button type="button" className="text-xs text-blue-600" disabled={busy} onClick={() => void action(refresh)}>Refresh delivery status</button>
      </>}
    </>}
  </div>;
}
