import { startHostedMeeting } from '../../lib/startHostedMeeting';
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '@/hooks/useMeeting';
import { TopBar } from './TopBar';
import { VideoGrid } from './VideoGrid';
import { BottomControls } from './BottomControls';
import { LeftPanel } from './LeftPanel';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { MeetingInfo } from './MeetingInfo';
import { SettingsPanel } from './SettingsPanel';
import { BackgroundPickerModal } from './BackgrounPickerModal';
import { WaitingRoom } from './WaitingRoom';
import { stopAllCameraStreams } from './CameraVideo';
import { Whiteboard } from './Whiteboard';
import {
  PenTool,
  Menu,
  X,
  PhoneOff,
  BarChart3,
  Check,
  Clock3,
  UserCheck,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { clearMeetingSession, getMeetingSession, storeMeetingSession, type MeetingSession } from '@/lib/meetingSession';
import { useSharedWhiteboard } from '@/hooks/useSharedWhiteboard';
import { clearStoredSession, getAuthToken, getStoredUser, type SessionUser } from '@/lib/auth';
import AuthModal from '../AuthModal';
import { useWebRtcMeeting } from '@/hooks/useWebRtcMeeting';
import { useScreenRecorder } from '@/hooks/useScreenRecorder';
import { RecordingsModal } from './RecordingsModal';
import { TranscriptModal } from './TranscriptModal';
import { useMeetingSummaryCapture } from '@/hooks/useMeetingSummaryCapture';

interface MeetingRoomProps {
  meetingCode?: string;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode = 'YLM-9284-XKP',
}) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null);
  const sessionRef = useRef<MeetingSession | null>(getMeetingSession(meetingCode));
  const rememberSession = (code: string, session: MeetingSession) => {
    sessionRef.current = session;
    storeMeetingSession(code, session);
  };
  const forgetSession = (code: string) => {
    if (getMeetingSession(code)?.participantId === sessionRef.current?.participantId) clearMeetingSession(code);
    sessionRef.current = null;
  };
  const meeting = useMeeting(meetingCode);
  const call = useWebRtcMeeting(
    meetingCode,
    meeting.inMeeting,
    meeting.isMicOn,
    meeting.isCameraOn,
    meeting.deviceSettings.backgroundBlur,
    meeting.isHandRaised,
    meeting.deviceSettings.micId,
    meeting.setMicEnabled,
    meeting.deviceSettings.cameraId,
    meeting.setCameraEnabled,
    sessionRef.current
  );
  const sharedWhiteboard = useSharedWhiteboard(meetingCode, meeting.inMeeting, sessionRef.current);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState<boolean>(false);
  const [admission, setAdmission] = useState<'idle' | 'pending' | 'denied'>('idle');
  const [isJoining, setIsJoining] = useState(false);
  const [admissionActions, setAdmissionActions] = useState<Set<string>>(new Set());
  const [mutingParticipantIds, setMutingParticipantIds] = useState<Set<string>>(new Set());
  const [isMutingAll, setIsMutingAll] = useState(false);
  const [participantToRemove, setParticipantToRemove] = useState<{ id: string; name: string } | null>(null);
  const [isRemovingParticipant, setIsRemovingParticipant] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [joinRequests, setJoinRequests] = useState<Array<{ id: string; name: string }>>([]);
  const [isRecordingsOpen, setIsRecordingsOpen] = useState(false);
  const [summaryReview, setSummaryReview] = useState<{ speech: string; occurrenceId?: string; warning: string } | null>(null);
  const [closingForSummary, setClosingForSummary] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatToast, setChatToast] = useState<{ sender: string; message: string } | null>(null);
  const seenChatIdsRef = useRef(new Set<string>());
  const chatToastTimerRef = useRef<number | null>(null);
  const leavingRef = useRef(false);
  const joiningRef = useRef(false);
  const loadingRequestsRef = useRef(false);
  const admissionActionsRef = useRef(new Set<string>());
  const recorder = useScreenRecorder();
  const transcript = useMeetingSummaryCapture(
    meeting.inMeeting && isHost, meetingCode, sessionRef.current?.occurrenceId,
    call.localStream, meeting.isMicOn, call.remoteStreams, call.remoteMicMuted,
  );

  useEffect(() => {
    let cancelled = false;
    setCheckingSession(true);
    setSessionError('');
    if (!getAuthToken()) {
      setUser(null);
      setCheckingSession(false);
      return;
    }
    void trpc.auth.me.query().then(({ user: account }) => {
      if (cancelled) return;
      setUser(account);
      meeting.setDisplayName(account.fullName);
    }).catch((error) => {
      if (cancelled) return;
      setUser(null);
      if (error?.data?.code === 'UNAUTHORIZED') {
        clearStoredSession();
        navigate(`/?join=${encodeURIComponent(meetingCode)}`, { replace: true });
      }
      else setSessionError('Unable to check your session. Please try again.');
    }).finally(() => {
      if (!cancelled) setCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, [sessionAttempt]);

  useEffect(() => meeting.syncParticipantAudio(call.remoteMicMuted), [call.remoteMicMuted]);
  useEffect(() => meeting.syncParticipantVideo(call.remoteCameraOn), [call.remoteCameraOn]);

  useEffect(() => {
    if (meeting.inMeeting && !meeting.isCameraOn) stopAllCameraStreams();
  }, [meeting.inMeeting, meeting.isCameraOn]);

  useEffect(() => {
    if (meeting.deviceSettings.micId !== 'default' && !call.audioInputDevices.some((device) => device.deviceId === meeting.deviceSettings.micId)) {
      meeting.setDeviceSettings((settings) => ({ ...settings, micId: 'default' }));
    }
  }, [call.audioInputDevices, meeting.deviceSettings.micId]);

  useEffect(() => {
    if (meeting.deviceSettings.cameraId !== 'default' && !call.videoInputDevices.some((device) => device.deviceId === meeting.deviceSettings.cameraId)) {
      meeting.setDeviceSettings((settings) => ({ ...settings, cameraId: 'default' }));
    }
  }, [call.videoInputDevices, meeting.deviceSettings.cameraId]);

  useEffect(() => {
    if (recorder.preview) setIsRecordingsOpen(true);
  }, [recorder.preview]);

  useEffect(() => {
    if (sharedWhiteboard.closeSignal > 0) meeting.setIsWhiteboardOpen(false);
  }, [sharedWhiteboard.closeSignal]);

  useEffect(() => {
    for (const message of call.chatMessages) {
      if (seenChatIdsRef.current.has(message.id)) continue;
      seenChatIdsRef.current.add(message.id);
      if (message.senderId === 'user-self') continue;
      if (meeting.activeSidebarTab !== 'chat') {
        setUnreadChatCount((count) => count + 1);
        setChatToast({ sender: message.senderName, message: message.message });
        if (chatToastTimerRef.current) window.clearTimeout(chatToastTimerRef.current);
        chatToastTimerRef.current = window.setTimeout(() => setChatToast(null), 4500);
      }
    }
    return () => {
      if (chatToastTimerRef.current) window.clearTimeout(chatToastTimerRef.current);
    };
  }, [call.chatMessages, meeting.activeSidebarTab]);

  useEffect(() => {
    if (!user) return;
    void trpc.meetings.getByCode.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId }).then(({ meeting: room }) => {
      meeting.setMeetingTitle(room.title);
      setIsHost(getStoredUser()?.id === room.hostUserId);
    }).catch(() => undefined);
  }, [meetingCode, user?.id]);

  useEffect(() => {
    if (!user || meeting.inMeeting || admission !== 'idle') return;
    const session = sessionRef.current;
    if (!session?.participantId) return;
    let cancelled = false;
    void trpc.meetings.admissionStatus.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId,
          participantId: session.participantId })
      .then(async (status) => {
        if (cancelled) return;
        if (status.sessionEnded) { forgetSession(meetingCode); return; }
        if (status.admission === 'pending') setAdmission('pending');
        else if (status.admission === 'denied') setAdmission('denied');
        else {
          await trpc.meetings.rejoin.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId,
          participantId: session.participantId! });
          if (!cancelled) meeting.joinMeeting();
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [admission, meeting.inMeeting, meetingCode, user?.id]);

  useEffect(() => {
    if (admission !== 'pending') return;
    const session = sessionRef.current;
    if (!session?.participantId) return;
    let checking = false;

    const checkAdmission = async () => {
      if (checking || leavingRef.current) return;
      checking = true;
      try {
        const result = await trpc.meetings.admissionStatus.query({
          meetingCode,
          occurrenceId: sessionRef.current?.occurrenceId,
          participantId: session.participantId!,
        });
        if (result.sessionEnded) { forgetSession(meetingCode); setAdmission('idle'); joiningRef.current = false; setIsJoining(false); return; }
        if (result.admission === 'admitted') {
          setAdmission('idle');
          meeting.joinMeeting();
        } else if (result.admission === 'denied') {
          setAdmission('denied');
        }
      } catch {
        // Temporary connectivity problems must not reject the participant.
      } finally {
        checking = false;
      }
    };

    void checkAdmission();
    const timer = window.setInterval(() => void checkAdmission(), 500);
    return () => window.clearInterval(timer);
  }, [admission, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting || !isHost) return;
    const loadRequests = async () => {
      if (loadingRequestsRef.current) return;
      loadingRequestsRef.current = true;
      try {
        const result = await trpc.meetings.pendingAdmissions.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
        setJoinRequests([...new Map(result.requests.map(({ id, name }) => [id, { id, name }])).values()]);
      } catch {
        // Preserve the last known list during temporary network failures.
      } finally {
        loadingRequestsRef.current = false;
      }
    };
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 750);
    return () => window.clearInterval(timer);
  }, [isHost, meeting.inMeeting, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting) return;
    const loadParticipants = async () => {
      try {
        const session = sessionRef.current;
        const result = await trpc.meetings.participants.query({
          meetingCode,
          occurrenceId: sessionRef.current?.occurrenceId,
          participantId: session?.participantId,
        });
        meeting.syncParticipants(result.participants);
      } catch {
        // Keep the most recent roster while a refresh is temporarily unavailable.
      }
    };
    void loadParticipants();
    const timer = window.setInterval(() => void loadParticipants(), 2000);
    return () => window.clearInterval(timer);
  }, [meeting.inMeeting, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting) return;
    let checking = false;
    const checkMembership = async () => {
      if (checking || leavingRef.current) return;
      checking = true;
      try {
        const session = sessionRef.current;
        if (session?.participantId) {
          const status = await trpc.meetings.admissionStatus.query({
            meetingCode,
            occurrenceId: sessionRef.current?.occurrenceId,
            participantId: session.participantId,
          });
          if (leavingRef.current) return;
          if (status.sessionEnded || status.meeting.status === 'ended' || status.leftAt || status.admission !== 'admitted') {
            forgetSession(meetingCode);
            stopAllCameraStreams();
            meeting.leaveMeeting();
            alert(status.sessionEnded || status.meeting.status === 'ended' ? 'The host ended the meeting.' : 'The host removed you from the meeting.');
            navigate('/');
          }
        } else {
          const { meeting: room } = await trpc.meetings.getByCode.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
          if (leavingRef.current) return;
          if (room.status === 'ended') {
            stopAllCameraStreams();
            meeting.leaveMeeting();
            alert('The meeting has ended.');
            navigate('/');
          }
        }
      } catch {
        // Keep the call active during temporary backend/network interruptions.
      } finally {
        checking = false;
      }
    };
    void checkMembership();
    const timer = window.setInterval(() => void checkMembership(), 2000);
    return () => window.clearInterval(timer);
  }, [meeting.inMeeting, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting) return;

    const reportPageExit = () => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      const session = sessionRef.current;
      const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
      const body = JSON.stringify({
        0: { json: { meetingCode, occurrenceId: sessionRef.current?.occurrenceId,
          participantId: session?.participantId } },
      });

      // keepalive lets the request finish while a refresh or tab close is
      // tearing down the document. The stored participant session remains so
      // a voluntary participant can still rejoin without another admission.
      void fetch(`${apiBase}/meetings.leave?batch=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener('pagehide', reportPageExit);
    return () => window.removeEventListener('pagehide', reportPageExit);
  }, [meeting.inMeeting, meetingCode]);

  const closeWithSummary = async (end: boolean) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setClosingForSummary(true);
    const session = sessionRef.current;
    const occurrenceId = session?.occurrenceId;
    try {
      await recorder.stop();
      const speech = await transcript.finish();
      if (end) {
        await trpc.meetings.end.mutate({ meetingCode, occurrenceId });
        forgetSession(meetingCode);
      } else {
        await trpc.meetings.leave.mutate({ meetingCode, occurrenceId, participantId: session?.participantId });
      }
      setSummaryReview({ speech, occurrenceId, warning: transcript.getWarning() });
      stopAllCameraStreams();
      meeting.leaveMeeting();
    } catch (error) {
      leavingRef.current = false;
      void transcript.resume();
      alert(error instanceof Error ? error.message : 'Unable to close the meeting. Please retry.');
    } finally { setClosingForSummary(false); }
  };

  const handleLeave = async () => {
    if (isHost) { await closeWithSummary(false); return; }
    if (leavingRef.current) return;
    const session = sessionRef.current;
    leavingRef.current = true;
    stopAllCameraStreams();
    meeting.leaveMeeting();
    try {
      await trpc.meetings.leave.mutate({ meetingCode, occurrenceId: session?.occurrenceId, participantId: session?.participantId });
    } catch (error) {
      console.warn('Presence cleanup will rely on LiveKit disconnect timeout.', error);
    }
    navigate('/');
  };

  const handleEndMeeting = () => {
    if (isHost) void closeWithSummary(true);
  };

  const removeParticipant = async (participantId: string) => {
    if (isRemovingParticipant) return;
    setIsRemovingParticipant(true);
    try {
      await trpc.meetings.removeParticipant.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId });
      setParticipantToRemove(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to remove participant.');
    } finally {
      setIsRemovingParticipant(false);
    }
  };

  const muteParticipant = async (participantId: string) => {
    if (mutingParticipantIds.has(participantId)) return;
    setMutingParticipantIds((current) => new Set(current).add(participantId));
    try {
      await trpc.meetings.muteParticipant.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to mute participant.');
    } finally {
      setMutingParticipantIds((current) => {
        const next = new Set(current);
        next.delete(participantId);
        return next;
      });
    }
  };

  const muteAllParticipants = async () => {
    if (!isHost || isMutingAll) return;
    setIsMutingAll(true);
    try {
      await trpc.meetings.muteAll.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to mute participants.');
    } finally {
      setIsMutingAll(false);
    }
  };

  const toggleRecording = async () => {
    if (!isHost) return;
    if (recorder.isRecording) {
      await recorder.stop();
      return;
    }
    if (recorder.preview) { setIsRecordingsOpen(true); return; }
    try {
      await recorder.start(sessionRef.current?.occurrenceId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to start screen recording.');
    }
  };

  const uploadChatFile = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) throw new Error('Files must be 25 MB or smaller.');
    const session = sessionRef.current;
    const upload = await trpc.chatAttachments.createUpload.mutate({
      meetingCode,
      occurrenceId: sessionRef.current?.occurrenceId,
      participantId: session?.participantId,
      fileName: file.name,
      fileSize: file.size,
    });
    const response = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });
    if (!response.ok) throw new Error(`File upload failed (${response.status}).`);
    const size = file.size >= 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    return {
      name: file.name,
      size,
      type: file.type || 'File',
      storagePath: upload.storagePath,
    };
  };

  const downloadChatFile = async (attachment: { name: string; size: string; type: string; storagePath?: string }) => {
    if (!attachment.storagePath) {
      alert('This attachment is not available for download.');
      return;
    }
    try {
      const session = sessionRef.current;
      const result = await trpc.chatAttachments.downloadUrl.mutate({
        meetingCode,
        occurrenceId: sessionRef.current?.occurrenceId,
        participantId: session?.participantId,
        storagePath: attachment.storagePath,
        fileName: attachment.name,
      });
      window.location.assign(result.url);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to download file.');
    }
  };

  const handleJoin = async () => {
    if (checkingSession || sessionError) return;
    if (!user) {
      setAuthMode('login');
      return;
    }
    const displayName = meeting.displayName.trim();
    if (!displayName || joiningRef.current || admission === 'pending') return;
    joiningRef.current = true;
    setIsJoining(true);

    try {
      let { meeting: room } = await trpc.meetings.getByCode.query({ meetingCode });
      if ((room.scheduleType === 'reusable' || room.scheduleType === 'recurring')) {
        if (!room.activeOccurrenceId && room.hostUserId === user.id) {
          ({ meeting: room } = await startHostedMeeting(room));
        }
        if (!room.activeOccurrenceId) throw new Error('The host has not opened this room yet. Please try again when the host starts it.');
        if (sessionRef.current?.occurrenceId !== room.activeOccurrenceId) {
          rememberSession(meetingCode, { displayName, occurrenceId: room.activeOccurrenceId, joinRequestId: crypto.randomUUID() });
        }
      }
      const existingSession = sessionRef.current;
      let joinRequestId = existingSession?.joinRequestId || crypto.randomUUID();
      rememberSession(meeting.meetingCode, { ...existingSession, displayName, joinRequestId });

      if (existingSession?.participantId) {
        let rejoined;
        try {
          rejoined = await trpc.meetings.rejoin.mutate({
            meetingCode: meeting.meetingCode,
            occurrenceId: sessionRef.current?.occurrenceId,
            participantId: existingSession.participantId,
          });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('A new admission is required')) throw error;
          joinRequestId = crypto.randomUUID();
          rememberSession(meeting.meetingCode, { displayName, occurrenceId: sessionRef.current?.occurrenceId, joinRequestId });
          const joined = await trpc.meetings.join.mutate({
            meetingCode: meeting.meetingCode,
            occurrenceId: sessionRef.current?.occurrenceId,
            joinRequestId,
          });
          rememberSession(meeting.meetingCode, {
            displayName,
            occurrenceId: joined.participant.occurrenceId ?? undefined,
            participantId: joined.participant.id,
            joinRequestId,
          });
          if (joined.participant.admission === 'admitted') meeting.joinMeeting();
          else setAdmission(joined.participant.admission === 'denied' ? 'denied' : 'pending');
          return;
        }
        try {
          await trpc.meetings.updateGuestName.mutate({
            meetingCode: meeting.meetingCode,
            occurrenceId: sessionRef.current?.occurrenceId,
            participantId: existingSession.participantId,
            guestName: displayName,
          });
        } catch {
          // Registered users store their name on the user account, not guest_name.
        }
        if (rejoined.participant.admission === 'admitted') meeting.joinMeeting();
        else setAdmission(rejoined.participant.admission === 'denied' ? 'denied' : 'pending');
      } else {
        const joined = await trpc.meetings.join.mutate({
          meetingCode: meeting.meetingCode,
          occurrenceId: sessionRef.current?.occurrenceId,
          joinRequestId,
        });
        rememberSession(meeting.meetingCode, {
          displayName,
          occurrenceId: joined.participant.occurrenceId ?? undefined,
          participantId: joined.participant.id,
          joinRequestId,
        });
        if (joined.participant.admission === 'admitted') meeting.joinMeeting();
        else setAdmission('pending');
      }
    } catch (error) {
      joiningRef.current = false;
      setIsJoining(false);
      alert(error instanceof Error ? error.message : 'Unable to join the meeting.');
    }
  };

  const decideAdmission = async (participantId: string, admit: boolean) => {
    if (admissionActionsRef.current.has(participantId)) return;
    admissionActionsRef.current.add(participantId);
    setAdmissionActions((current) => new Set(current).add(participantId));
    try {
      await trpc.meetings.decideAdmission.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId, admit });
      setJoinRequests((requests) => requests.filter((request) => request.id !== participantId));
    } finally {
      admissionActionsRef.current.delete(participantId);
      setAdmissionActions((current) => {
        const next = new Set(current);
        next.delete(participantId);
        return next;
      });
    }
  };

  if (admission === 'pending' || admission === 'denied') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-8 text-center shadow-2xl">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
            <Clock3 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">{admission === 'pending' ? 'Waiting for the host' : 'Request not accepted'}</h1>
          <p className="mt-3 text-sm text-slate-400">
            {admission === 'pending'
              ? `Your request to join ${meeting.meetingTitle} was sent. You will enter automatically when the host admits you.`
              : 'The host declined this join request. Contact the host if you think this was a mistake.'}
          </p>
          <button onClick={() => navigate('/')} className="mt-7 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/15">
            Return home
          </button>
        </div>
      </div>
    );
  }

  // If in waiting room mode, render WaitingRoom
  if (summaryReview) return <>
    <TranscriptModal meetingCode={meetingCode} occurrenceId={summaryReview.occurrenceId}
      speech={summaryReview.speech} warning={summaryReview.warning} onClose={() => navigate('/')}
      onOpenRecordings={recorder.preview ? () => setIsRecordingsOpen(true) : undefined} />
    <RecordingsModal isOpen={isRecordingsOpen} meetingCode={meetingCode} preview={recorder.preview}
      onClose={() => setIsRecordingsOpen(false)} onDiscardPreview={recorder.clearPreview} />
  </>;

  if (!meeting.inMeeting) {
    return (
      <>
      <WaitingRoom
        accountEmail={user?.email}
        checkingSession={checkingSession}
        sessionError={sessionError}
        onRetrySession={() => setSessionAttempt((attempt) => attempt + 1)}
        onOpenAuth={setAuthMode}
        meetingCode={meeting.meetingCode}
        meetingTitle={meeting.meetingTitle}
        isMicOn={meeting.isMicOn}
        onToggleMic={meeting.toggleMic}
        isCameraOn={meeting.isCameraOn}
        onToggleCamera={meeting.toggleCamera}
        onJoin={() => void handleJoin()}
        displayName={meeting.displayName}
        onDisplayNameChange={meeting.setDisplayName}
        deviceSettings={meeting.deviceSettings}
        setDeviceSettings={meeting.setDeviceSettings}
        isJoining={isJoining}
      />
      <AuthModal
        isOpen={authMode !== null}
        mode={authMode || 'login'}
        onClose={() => setAuthMode(null)}
        onSuccess={(account) => {
          meeting.setDisplayName(account.fullName);
          setUser(account);
          setSessionError('');
          setAuthMode(null);
        }}
      />
      </>
    );
  }

  return (
    <div className="w-full h-screen bg-gradient-to-br from-[#070a18] via-[#11162a] to-[#1b1038] text-slate-800 flex flex-col justify-start overflow-hidden relative select-none font-sans">
      {call.microphoneError && (
        <div role="alert" className="fixed left-1/2 top-4 z-[120] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-xl">
          {call.microphoneError}
        </div>
      )}
      {call.cameraError && (
        <div role="alert" className="fixed left-1/2 top-20 z-[120] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-xl">
          {call.cameraError}
        </div>
      )}
      {isHost && joinRequests.length > 0 && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Meeting join requests" className="w-full max-w-md rounded-3xl border border-blue-200 bg-white p-6 shadow-2xl">
            <div className="mb-2 flex items-center gap-3 text-slate-900">
              <div className="rounded-2xl bg-blue-100 p-3 text-blue-600">
                <UserCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Someone wants to join</h2>
                <p className="text-xs text-slate-500">Choose who can enter this meeting.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {joinRequests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-3 truncate text-base font-semibold text-slate-900">{request.name}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button disabled={admissionActions.has(request.id)} onClick={() => void decideAdmission(request.id, false)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50">
                      <X className="h-4 w-4" /> {admissionActions.has(request.id) ? 'Processing...' : 'Deny'}
                    </button>
                    <button disabled={admissionActions.has(request.id)} onClick={() => void decideAdmission(request.id, true)} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-50">
                      <Check className="h-4 w-4" /> {admissionActions.has(request.id) ? 'Processing...' : 'Admit'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Background ambient lighting orbs */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-200/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-sky-200/50 rounded-full blur-[120px] pointer-events-none" />

      {chatToast && meeting.activeSidebarTab !== 'chat' && (
        <button
          type="button"
          onClick={() => {
            setChatToast(null);
            setUnreadChatCount(0);
            meeting.toggleSidebarTab('chat');
          }}
          className="fixed bottom-24 left-1/2 z-[110] w-[min(92vw,380px)] -translate-x-1/2 rounded-2xl border border-blue-200 bg-white/95 p-4 text-left shadow-2xl backdrop-blur-xl animate-fadeIn"
        >
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate text-xs font-bold text-blue-700">{chatToast.sender}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">New message</span>
          </div>
          <p className="truncate text-sm text-slate-700">{chatToast.message}</p>
        </button>
      )}

      {/* TOP BAR */}
      <TopBar
        meetingTitle={meeting.meetingTitle}
        meetingCode={meeting.meetingCode}
        durationSeconds={meeting.durationSeconds}
        isRecording={recorder.isRecording}
        recordingMs={recorder.recordingMs}
        onOpenInfo={() => meeting.setIsInfoOpen(true)}
        onOpenLeave={() => meeting.setIsLeaveModalOpen(true)}
        layoutMode={meeting.layoutMode}
        onChangeLayout={meeting.setLayoutMode}
        inviteLink={meeting.meetingInfo.inviteLink}
        isHost={isHost}
        onEndMeeting={() => void handleEndMeeting()}
      />

      <div className="relative z-40 shrink-0 px-3 sm:px-4 pt-2">
        <button
          type="button"
          onClick={() => setIsLeftPanelOpen((open) => !open)}
          aria-label={isLeftPanelOpen ? 'Hide meeting toolbar' : 'Show meeting toolbar'}
          aria-expanded={isLeftPanelOpen}
          aria-controls="meeting-left-toolbar"
          title={isLeftPanelOpen ? 'Hide meeting toolbar' : 'Show meeting toolbar'}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-slate-900/80 text-white shadow-md transition-colors hover:bg-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* MAIN CONTENT AREA: Left Panel + Video Stage + Right Sidebar */}
      <div className="flex-1 min-h-0 w-full flex items-stretch overflow-hidden relative p-3 sm:p-4 gap-3 sm:gap-4">
        {/* Keep the toolbar mounted so hiding it only changes presentation. */}
        <div
          id="meeting-left-toolbar"
          aria-hidden={!isLeftPanelOpen}
          inert={!isLeftPanelOpen}
          className={`relative z-40 shrink-0 transition-[width,margin-right] duration-300 ease-in-out motion-reduce:transition-none ${
            isLeftPanelOpen ? 'w-16 sm:w-20 mr-0' : 'w-0 -mr-3 sm:-mr-4 pointer-events-none'
          }`}
        >
          <div className={`h-full w-16 sm:w-20 transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
            isLeftPanelOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)]'
          }`}>
        <LeftPanel
          isWhiteboardOpen={meeting.isWhiteboardOpen}
          onToggleWhiteboard={() => meeting.setIsWhiteboardOpen((prev) => !prev)}
          isBgPickerOpen={isBgPickerOpen}
          onToggleBgPicker={() => setIsBgPickerOpen((prev) => !prev)}
          activeSidebarTab={meeting.activeSidebarTab}
          onToggleSidebarTab={(tab) => {
            if (tab === 'chat') {
              setUnreadChatCount(0);
              setChatToast(null);
            }
            meeting.toggleSidebarTab(tab);
          }}
          isRecording={recorder.isRecording}
          onToggleRecording={() => void toggleRecording()}
          onOpenSettings={() => meeting.setIsSettingsOpen(true)}
          participantsCount={meeting.participants.length}
          isHost={isHost}
          onOpenRecordings={() => setIsRecordingsOpen(true)}
          unreadChatCount={unreadChatCount}
        />
          </div>
        </div>

      <RecordingsModal
        isOpen={isHost && isRecordingsOpen}
        meetingCode={meetingCode}
        preview={recorder.preview}
        onClose={() => setIsRecordingsOpen(false)}
        onDiscardPreview={recorder.clearPreview}
      />

      {closingForSummary && <div role="status" className="fixed inset-0 z-[110] bg-black/80 text-white flex items-center justify-center">Finishing speech capture and closing the call...</div>}
      <div className="fixed bottom-24 left-4 z-30 max-w-sm rounded-lg bg-zinc-900/90 p-2 text-xs text-zinc-300">
        {isHost ? transcript.error || 'Meeting speech is processed by OpenAI for an English summary.' : 'The host can process meeting speech with OpenAI for an English summary.'}
        {isHost && transcript.error && <button className="block underline" onClick={() => void transcript.resume()}>Enable summary capture</button>}
      </div>


        {/* CENTER VIDEO GRID & STAGE */}
        <div className="flex-1 h-full min-h-0 overflow-hidden flex flex-col relative">
          <VideoGrid
            participants={meeting.participants}
            activeSpeakerId={meeting.activeSpeakerId}
            pinnedParticipantId={meeting.pinnedParticipantId}
            layoutMode={meeting.layoutMode}
            activeBg={meeting.deviceSettings.backgroundBlur}
            onTogglePin={meeting.togglePinParticipant}
            onToggleMute={meeting.toggleMuteParticipant}
            onSelectSpeaker={meeting.setActiveSpeakerId}
            localStream={call.localStream}
            remoteStreams={call.remoteStreams}
            remoteBackgrounds={call.remoteBackgrounds}
            remoteScreenShares={call.remoteScreenShares}
            remoteRaisedHands={call.remoteRaisedHands}
            localDisplayStream={call.displayStream}
          />

          {/* BOTTOM TOOLBAR CONTROLS (Below Video Grid in center column) */}
          <BottomControls
            isMicOn={meeting.isMicOn}
            onToggleMic={meeting.toggleMic}
            isCameraOn={meeting.isCameraOn}
            onToggleCamera={meeting.toggleCamera}
            isScreenSharing={call.isScreenSharing}
            onToggleScreenSharing={() => {
              if (call.isScreenSharing) {
                call.stopScreenShare();
              } else {
                void call.startScreenShare().catch((error) => {
                  if (error instanceof DOMException && error.name === 'NotAllowedError') return;
                  alert(error instanceof Error ? error.message : 'Unable to share the screen.');
                });
              }
            }}
            isHandRaised={meeting.isHandRaised}
            onToggleHandRaised={meeting.toggleHandRaised}
            onOpenLeave={() => meeting.setIsLeaveModalOpen(true)}
          />

          {/* Collaborative Whiteboard Canvas Overlay */}
          {meeting.isWhiteboardOpen && (
            <Whiteboard
              onClose={() => {
                meeting.setIsWhiteboardOpen(false);
                if (sharedWhiteboard.isHost && sharedWhiteboard.shared) sharedWhiteboard.closeShared();
              }}
              shared={sharedWhiteboard.shared}
              connected={sharedWhiteboard.connected}
              connectionError={sharedWhiteboard.connectionError}
              isHost={sharedWhiteboard.isHost}
              canEdit={!sharedWhiteboard.shared || !sharedWhiteboard.connected ? true : sharedWhiteboard.canEdit}
              participants={sharedWhiteboard.participants}
              remoteSnapshot={sharedWhiteboard.shared ? sharedWhiteboard.snapshot : null}
              onToggleShare={sharedWhiteboard.setShared}
              onGrantAccess={sharedWhiteboard.grantAccess}
              onPublishSnapshot={sharedWhiteboard.publishSnapshot}
            />
          )}
        </div>

        {/* RIGHT SIDEBAR (Chat / Participants / Activities) */}
        {meeting.activeSidebarTab && (
          <div className="w-full sm:w-80 md:w-96 h-full min-h-0 flex-shrink-0 z-30 transition-all duration-300 animate-slideLeft">
            {meeting.activeSidebarTab === 'chat' && (
              <ChatPanel
                messages={call.chatMessages}
                onSendMessage={(text, fileAttachment) => call.sendChatMessage(text, fileAttachment)}
                onUploadFile={uploadChatFile}
                onDownloadFile={(attachment) => void downloadChatFile(attachment)}
                onClose={() => meeting.toggleSidebarTab(null)}
              />
            )}

            {meeting.activeSidebarTab === 'participants' && (
              <ParticipantsPanel
                participants={meeting.participants}
                onToggleMute={meeting.toggleMuteParticipant}
                onTogglePin={meeting.togglePinParticipant}
                onClose={() => meeting.toggleSidebarTab(null)}
                onOpenInfo={() => meeting.setIsInfoOpen(true)}
                isHost={isHost}
                onRemoveParticipant={(participantId) => {
                  const participant = meeting.participants.find((entry) => entry.id === participantId);
                  if (participant) setParticipantToRemove({ id: participantId, name: participant.name });
                }}
                onMuteParticipant={(participantId) => void muteParticipant(participantId)}
                onMuteAll={() => void muteAllParticipants()}
                mutingParticipantIds={mutingParticipantIds}
                isMutingAll={isMutingAll}
              />
            )}

            {meeting.activeSidebarTab === 'activities' && (
              <div className="w-full h-full flex flex-col bg-white/75 backdrop-blur-2xl border border-white rounded-3xl shadow-xl text-slate-800 p-5 overflow-hidden">
                <div className="flex items-center justify-between pb-4 border-b border-blue-50 mb-4">
                  <h2 className="font-bold text-base text-slate-900">Meeting Activities</h2>
                  <button
                    onClick={() => meeting.toggleSidebarTab(null)}
                    className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 overflow-y-auto pr-1">
                  {/* Collaborative Whiteboard launcher */}
                  <div
                    onClick={() => {
                      meeting.setIsWhiteboardOpen(true);
                      meeting.toggleSidebarTab(null);
                    }}
                    className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100 hover:border-blue-300 hover:bg-blue-50/90 cursor-pointer transition-all space-y-2 group shadow-sm"
                  >
                    <div className="flex items-center space-x-3 text-blue-600 font-bold text-sm">
                      <PenTool className="w-5 h-5" />
                      <span>Collaborative Whiteboard</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Brainstorm, sketch floor plans, and drop sticky notes together.
                    </p>
                  </div>

                  {/* Polls Activity */}
                  <div className="p-4 rounded-2xl bg-white/80 border border-blue-100/80 shadow-sm space-y-3">
                    <div className="flex items-center space-x-3 text-indigo-600 font-bold text-sm">
                      <BarChart3 className="w-5 h-5" />
                      <span>Live Polls</span>
                    </div>
                    {meeting.polls.map((poll) => (
                      <div key={poll.id} className="space-y-2 pt-1">
                        <p className="text-xs font-semibold text-slate-800">{poll.question}</p>
                        <div className="space-y-1.5">
                          {poll.options.map((opt) => (
                            <button
                              key={opt.id}
                              disabled={poll.hasVoted}
                              onClick={() => meeting.votePoll(poll.id, opt.id)}
                              className={`w-full p-2.5 rounded-xl text-left text-xs font-medium border transition-all flex items-center justify-between ${
                                poll.hasVoted
                                  ? 'bg-slate-50 border-slate-200 text-slate-600'
                                  : 'bg-white hover:bg-blue-50 border-blue-100 text-slate-800'
                              }`}
                            >
                              <span>{opt.text}</span>
                              <span className="font-mono text-[11px] text-blue-600 font-semibold">
                                {opt.votes} votes
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      {participantToRemove && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="remove-participant-title" className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="mb-5">
              <h3 id="remove-participant-title" className="text-lg font-bold">Remove participant?</h3>
              <p className="mt-2 text-sm text-slate-400">{participantToRemove.name} will be disconnected from this meeting and will not be able to continue with the current session.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button disabled={isRemovingParticipant} onClick={() => setParticipantToRemove(null)} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50">Cancel</button>
              <button disabled={isRemovingParticipant} onClick={() => void removeParticipant(participantToRemove.id)} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60">{isRemovingParticipant ? 'Removing...' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}
      {meeting.isInfoOpen && (
        <MeetingInfo info={meeting.meetingInfo} onClose={() => meeting.setIsInfoOpen(false)} />
      )}

      {meeting.isSettingsOpen && (
        <SettingsPanel
          deviceSettings={meeting.deviceSettings}
          setDeviceSettings={meeting.setDeviceSettings}
          audioInputDevices={call.audioInputDevices}
          microphoneError={call.microphoneError}
          videoInputDevices={call.videoInputDevices}
          cameraError={call.cameraError}
          onEnsureCameraOn={() => {
            if (!meeting.isCameraOn) meeting.toggleCamera();
          }}
          onClose={() => meeting.setIsSettingsOpen(false)}
        />
      )}

      {isBgPickerOpen && (
        <BackgroundPickerModal
          activeBg={meeting.deviceSettings.backgroundBlur}
          localStream={call.localStream}
          isCameraOn={meeting.isCameraOn}
          onApplyBg={(bg) => {
            if (!meeting.isCameraOn) meeting.toggleCamera();
            meeting.setDeviceSettings((prev) => ({ ...prev, backgroundBlur: bg }));
          }}
          onClose={() => setIsBgPickerOpen(false)}
        />
      )}

      {/* Leave Meeting Confirmation Modal */}
      {meeting.isLeaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-white/15 rounded-3xl p-6 text-white shadow-2xl space-y-5 text-center">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <PhoneOff className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold">Leave YLAAM-MEET Meeting?</h3>
              <p className="text-xs text-slate-400">
                You can rejoin this room at any time using the same meeting link.
              </p>
            </div>
            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => meeting.setIsLeaveModalOpen(false)}
                className="flex-1 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm border border-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleLeave}
                className="flex-1 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs sm:text-sm shadow-lg shadow-rose-600/30 transition-all"
              >
                Leave Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
