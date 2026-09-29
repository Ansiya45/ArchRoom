import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import type { MeetingRecord } from '../lib/meetingSchedule';
import { getStoredUser } from '../lib/auth';
import { MeetingCalendarLinks } from './MeetingCalendarLinks';
import { ChevronDown, Users } from 'lucide-react';
type Info = Awaited<ReturnType<typeof trpc.meetingNotifications.info.query>>;
export function MeetingNotifications({ meeting }: { meeting: MeetingRecord }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInvitees, setShowInvitees] = useState(false);
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
  const invitedPeople = info?.invitations.filter(row => row.email !== email) || [];
  const panelId = `meeting-notifications-${meeting.id}`;
  const configurationHelpId = `${panelId}-configuration-help`;
  const inviteesId = `${panelId}-invitees`;
  return <div className="min-w-0 text-sm space-y-3 border-t border-slate-100 pt-3">
    <button type="button" className="flex w-full items-center justify-between gap-3 rounded text-left text-blue-600 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" disabled={busy}
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <span>Calendar, invitations & reminders</span>
      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={panelId} className="min-w-0 space-y-3">
      {busy && <p className="text-xs text-slate-500">Loading...</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {message && <p role="status" className="text-xs text-green-700">{message}</p>}
      {info && <>
        <MeetingCalendarLinks calendar={info.calendar} />
        {!info.emailConfigured && <p id={configurationHelpId} className="text-xs text-slate-500">Invitations and reminders are unavailable until this server has email delivery and a public meeting URL configured.</p>}
        <label className="block min-w-0 text-xs font-semibold">Invite by email
          <textarea className="mt-1 block w-full max-w-full rounded-xl border border-slate-200 p-2 font-normal disabled:cursor-not-allowed disabled:bg-slate-100" placeholder="name@example.com, teammate@example.com"
            value={emails} onChange={e => setEmails(e.target.value)} disabled={busy || !info.emailConfigured}
            aria-describedby={!info.emailConfigured ? configurationHelpId : undefined} />
        </label>
        <button type="button" className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" disabled={busy || !info.emailConfigured || !emails.trim() || (meeting.status === 'ended' || !!meeting.recurrenceCancelledAt)} onClick={() => void action(async () => {
          const result = await trpc.meetingNotifications.invite.mutate({ meetingId: meeting.id, emails: emails.split(/[,;\s]+/).filter(Boolean) });
          setEmails(''); await refresh(); setMessage(result.message);
        })}>Send invitations</button>
        <p className="text-xs text-slate-500">Invitees choose whether to receive email reminders. Invitations never bypass the waiting room.</p>
        {meeting.scheduledAt && meeting.scheduleType !== 'reusable' && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" checked={own?.remindersEnabled || false} disabled={busy || (!own?.remindersEnabled && (!info.emailConfigured || (meeting.status === 'ended' || !!meeting.recurrenceCancelledAt)))} aria-describedby={!info.emailConfigured ? configurationHelpId : undefined} onChange={e => { const enabled = e.target.checked; void action(async () => { await trpc.meetingNotifications.myReminder.mutate({ meetingId: meeting.id, enabled }); await refresh(); }); }} />Email me 10 minutes before each scheduled occurrence</label>}
        <button type="button" className="flex items-center gap-2 rounded text-xs font-semibold text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          aria-expanded={showInvitees} aria-controls={inviteesId} onClick={() => setShowInvitees(value => !value)}>
          <Users aria-hidden="true" className="h-4 w-4" />
          <span>{showInvitees ? 'Hide' : 'View'} invited people ({invitedPeople.length})</span>
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${showInvitees ? 'rotate-180' : ''}`} />
        </button>
        {showInvitees && <div id={inviteesId} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {invitedPeople.length === 0
            ? <p className="text-xs text-slate-500">No people have been invited yet.</p>
            : invitedPeople.map(invitation => {
              const delivery = info.deliveries.find(item => item.invitationId === invitation.id && item.kind === 'invitation');
              return <div key={invitation.id} className="break-all text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{invitation.email}</span>
                <span> · invitation {delivery?.status || 'processing'} · reminders {invitation.remindersEnabled ? 'on' : 'off'}</span>
              </div>;
            })}
        </div>}
        <button type="button" className="text-xs text-blue-600" disabled={busy} onClick={() => void action(refresh)}>Refresh delivery status</button>
      </>}
    </div>}
  </div>;
}
