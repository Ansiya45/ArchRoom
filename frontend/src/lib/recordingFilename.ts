// Meetings without a valid configured timezone use UTC.
export function recordingFilename(title: string, timeZone: string | null | undefined, startedAt: Date, recordingId: string, mimeType: string) {
  const name = title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'Meeting';
  const format = (zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(startedAt);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = format(timeZone || 'UTC'); } catch { parts = format('UTC'); }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  const extension = mimeType === 'video/mp4' ? 'mp4' : 'webm';
  return `${name} - ${value('year')}-${value('month')}-${value('day')} - ${value('hour')}-${value('minute')} - ${recordingId}.${extension}`;
}
