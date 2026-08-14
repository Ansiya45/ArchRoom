export interface MeetingSession {
  displayName: string;
  participantId?: string;
}

function sessionKey(meetingCode: string) {
  return `ylaam_meet_participant_${meetingCode.trim().toUpperCase()}`;
}

export function getMeetingSession(meetingCode: string): MeetingSession | null {
  const stored = window.sessionStorage.getItem(sessionKey(meetingCode));
  if (!stored) return null;

  try {
    return JSON.parse(stored) as MeetingSession;
  } catch {
    window.sessionStorage.removeItem(sessionKey(meetingCode));
    return null;
  }
}

export function storeMeetingSession(meetingCode: string, session: MeetingSession) {
  window.sessionStorage.setItem(sessionKey(meetingCode), JSON.stringify(session));
}
