type Calendar = { googleUrl: string; ics: string | null; recurring: boolean; occurrenceStart: string | null; timeZone: string | null; exceptions?: boolean };
export function MeetingCalendarLinks({ calendar }: { calendar: Calendar | null }) {
  if (!calendar) return null;
  const download = () => {
    if (!calendar.ics) return;
    const url = URL.createObjectURL(new Blob([calendar.ics], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ylaam-meeting.ics'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-2 text-sm">
    <a className="text-blue-600 font-semibold" href={calendar.googleUrl} target="_blank" rel="noopener noreferrer">Add {calendar.recurring ? 'series' : 'meeting'} to Google Calendar</a>
    {calendar.ics && <button type="button" className="block text-blue-600 font-semibold" onClick={download}>Download calendar event{calendar.recurring ? ' (next occurrence only)' : ''}</button>}
    {calendar.occurrenceStart && <p className="text-xs text-slate-500">Calendar event: {new Date(calendar.occurrenceStart).toLocaleString(undefined, { ...(calendar.timeZone ? { timeZone: calendar.timeZone } : {}), timeZoneName: 'short' })}</p>}
    {calendar.exceptions && <p className="text-xs text-slate-500">This series has schedule exceptions. Export contains only the next available occurrence.</p>}
    <p className="text-xs text-slate-500">Calendar copies are optional and do not sync later changes. Review the time and use the YLAAM Meet link in the event location to join. No meeting duration is set.</p>
  </div>;
}
