import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';
import { MeetingCalendarLinks } from './MeetingCalendarLinks';
type Preferences = Awaited<ReturnType<typeof trpc.meetingNotifications.preferences.mutate>>;
export function MeetingNotificationPreferences() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [data, setData] = useState<Preferences | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    // Keep the capability out of referrers and subsequent address-bar copies.
    window.history.replaceState(null, '', window.location.pathname);
    let cancelled = false;
    trpc.meetingNotifications.preferences.mutate({ token }).then(value => { if (!cancelled) setData(value); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to open invitation.'); });
    return () => { cancelled = true; };
  }, [token]);
  const change = async (enabled: boolean) => {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { await trpc.meetingNotifications.setPreferences.mutate({ token, enabled }); setData(current => current ? { ...current, remindersEnabled: enabled } : current); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save preference.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center"><section className="max-w-lg w-full rounded-3xl bg-white border border-slate-200 p-6 space-y-4">
    <h1 className="text-xl font-bold">YLAAM Meet invitation</h1>
    {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    {data && <><h2 className="font-semibold">{data.title}</h2><a className="text-blue-600 block" href={`/meet/${encodeURIComponent(data.meetingCode)}`}>Open meeting</a><p className="text-sm text-slate-500">The host must open the meeting and admit you.</p>
      <MeetingCalendarLinks calendar={data.calendar} />
      {data.cancelled && <p className="text-red-600 font-semibold">This recurring series has been cancelled.</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || (!data.canRemind && !data.remindersEnabled)} checked={data.remindersEnabled} onChange={e => void change(e.target.checked)} />Email me 10 minutes before scheduled occurrences</label>
      <p className="text-xs text-slate-500">{data.canRemind ? 'Reminders are sent only while enabled. Use this email link again to turn them off.' : 'This meeting has no upcoming scheduled reminders.'}</p>
    </>}
  </section></main>;
}
