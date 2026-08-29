export interface MeetingSession {
  displayName: string;
  participantId?: string;
  joinRequestId?: string;
}

function sessionKey(meetingCode: string) {
  return `ylaam_meet_participant_${meetingCode.trim().toUpperCase()}`;
}

export function getMeetingSession(meetingCode: string): MeetingSession | null {
  const key = sessionKey(meetingCode);
  const stored = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
  if (!stored) return null;

  try {
    const session = JSON.parse(stored) as MeetingSession;
    window.localStorage.setItem(key, stored);
    window.sessionStorage.removeItem(key);
    return session;
  } catch {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function storeMeetingSession(meetingCode: string, session: MeetingSession) {
  window.localStorage.setItem(sessionKey(meetingCode), JSON.stringify(session));
}

export function clearMeetingSession(meetingCode: string) {
  const key = sessionKey(meetingCode);
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}
