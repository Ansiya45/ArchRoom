export type RecordingNoticeState = 'started' | 'paused' | 'resumed' | 'stopped';
export type RecordingNotice = { state: RecordingNoticeState; sentAt: number };

// Notices are advisory: they do not establish participant consent.
export function acceptRecordingNotice(value: unknown, previous: RecordingNotice | undefined, now: number): RecordingNotice | null {
  if (!value || typeof value !== 'object') return null;
  const notice = value as Partial<RecordingNotice>;
  if (!['started', 'paused', 'resumed', 'stopped'].includes(String(notice.state)) ||
      !Number.isSafeInteger(notice.sentAt) || notice.sentAt! > now + 5000 || notice.sentAt! < now - 30000 ||
      (previous && notice.sentAt! <= previous.sentAt)) return null;
  return { state: notice.state as RecordingNoticeState, sentAt: notice.sentAt! };
}
