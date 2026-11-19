export function companyRecordingFilename(title: string, timeZone: string | null | undefined, startedAt: Date, recordingId: string, mimeType: 'video/webm' | 'video/mp4') {
  if (!Number.isFinite(startedAt.getTime()) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordingId)) throw new Error('Invalid recording filename metadata.');
  const name=title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,120) || 'Meeting';
  const format=(zone:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(startedAt);
  let parts:Intl.DateTimeFormatPart[];
  try { parts=format(timeZone || 'UTC'); } catch { parts=format('UTC'); }
  const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value ?? '';
  return `${name} - ${value('year')}-${value('month')}-${value('day')} - ${value('hour')}-${value('minute')} - ${recordingId}.${mimeType==='video/mp4'?'mp4':'webm'}`;
}
