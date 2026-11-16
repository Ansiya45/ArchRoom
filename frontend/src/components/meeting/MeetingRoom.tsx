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
  Copy,
  Clock3,
  UserCheck,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { clearMeetingSession, getMeetingSession, storeMeetingSession, type MeetingSession } from '@/lib/meetingSession';
import { useSharedWhiteboard } from '@/hooks/useSharedWhiteboard';
import { clearStoredSession, getAuthToken, getStoredUser, type SessionUser } from '@/lib/auth';
import { useWebRtcMeeting } from '@/hooks/useWebRtcMeeting';
import { useScreenRecorder } from '@/hooks/useScreenRecorder';
import { useCompanyRecordingUpload } from '@/hooks/useCompanyRecordingUpload';
import { canLeaveRecordingReview, verifiedCompanyRecordingLink } from '@/lib/companyRecordingUpload';
import { LocalRecoverySetup } from './LocalRecoverySetup';
import { LocalRecordingWriter } from '@/lib/localRecordingStore';
import type { RecoverySetup } from '@/hooks/useScreenRecorder';
import { RecordingsModal } from './RecordingsModal';
import { TranscriptModal } from './TranscriptModal';
import { useMeetingSummaryCapture } from '@/hooks/useMeetingSummaryCapture';

interface MeetingRoomProps {
  meetingCode?: string;
}

type AiStatus = Awaited<ReturnType<typeof trpc.meetings.aiStatus.query>>;

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode = 'YLM-9284-XKP',
}) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [meetingError, setMeetingError] = useState('');
  const [checkingMeeting, setCheckingMeeting] = useState(false);
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
  const [recordingTimeZone, setRecordingTimeZone] = useState<string | null>(null);
  const [recordingFolderId, setRecordingFolderId] = useState<string | null>(null);
  const [recordingMeetingId, setRecordingMeetingId] = useState<string | null>(null);
  const [recordingAccessPolicy, setRecordingAccessPolicy] = useState<'private' | 'restricted' | 'anyone_with_link'>('private');
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
  const [isHost, setIsHost] = useState(false);
  const sharedWhiteboard = useSharedWhiteboard(meetingCode, meeting.inMeeting, sessionRef.current, isHost);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState<boolean>(false);
  const [admission, setAdmission] = useState<'idle' | 'pending' | 'denied'>('idle');
  const [isJoining, setIsJoining] = useState(false);
  const [admissionActions, setAdmissionActions] = useState<Set<string>>(new Set());
  const [mutingParticipantIds, setMutingParticipantIds] = useState<Set<string>>(new Set());
  const [isMutingAll, setIsMutingAll] = useState(false);
  const [participantToRemove, setParticipantToRemove] = useState<{ id: string; name: string } | null>(null);
  const [isRemovingParticipant, setIsRemovingParticipant] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'off' });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCaptureFault, setAiCaptureFault] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiStatusError, setAiStatusError] = useState('');
  const [aiNoticeVisible, setAiNoticeVisible] = useState(false);
  const [enableAiOnJoin, setEnableAiOnJoin] = useState(false);
  const aiStartedForSession = useRef('');
  const [joinRequests, setJoinRequests] = useState<Array<{ id: string; name: string }>>([]);
  const previousJoinRequestIdsRef = useRef<Set<string>>(new Set());
  const [admissionNotice, setAdmissionNotice] = useState('');
  const [admissionError, setAdmissionError] = useState('');
  const [admissionActionError, setAdmissionActionError] = useState('');
  const [isRecordingsOpen, setIsRecordingsOpen] = useState(false);
  const [summaryReview, setSummaryReview] = useState<{ speech: string; occurrenceId?: string; warning: string } | null>(null);
  const [closingForSummary, setClosingForSummary] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatToast, setChatToast] = useState<{ sender: string; message: string } | null>(null);
  const seenChatIdsRef = useRef(new Set<string>());
  const chatToastTimerRef = useRef<number | null>(null);
  const leavingRef = useRef(false);
  const joiningRef = useRef(false);
  const admissionActionsRef = useRef(new Set<string>());
  const recorder = useScreenRecorder(call.localStream, meeting.isMicOn, meeting.meetingTitle, recordingTimeZone);
  const companyUpload = useCompanyRecordingUpload();
  const manualRecordingStop = useRef(false);
  const priorRecordingNotice = useRef<'started' | 'paused' | 'resumed' | 'stopped'>('stopped');
  useEffect(() => {
    if (!meeting.inMeeting || !call.isConnected) return;
    const previous = priorRecordingNotice.current;
    const state = !recorder.isRecording ? 'stopped' : recorder.isPaused ? 'paused' : previous === 'paused' ? 'resumed' : 'started';
    if (state !== 'stopped' || previous !== 'stopped') call.publishRecordingNotice(state);
    priorRecordingNotice.current = state;
    if (state === 'stopped') return;
    const timer = window.setInterval(() => call.publishRecordingNotice(state), 2000);
    return () => window.clearInterval(timer);
  }, [meeting.inMeeting, call.isConnected, call.publishRecordingNotice, recorder.isRecording, recorder.isPaused]);
  const [recordingReview, setRecordingReview] = useState(false);
  const [verifiedRecordingLinks, setVerifiedRecordingLinks] = useState<Record<string, string>>({});
  const [recordingLinkNotice, setRecordingLinkNotice] = useState('');
  const [copiedRecordingLink, setCopiedRecordingLink] = useState<string | null>(null);
  useEffect(() => {
    const completed = companyUpload.statuses.filter(status => status.stage === 'completed');
    if (!recordingReview || !recordingMeetingId || !user?.id || !completed.length) {
      setVerifiedRecordingLinks({});
      return;
    }
    let active = true;
    const ownerId = user.id;
    void trpc.meetings.historyDetail.query({ meetingId: recordingMeetingId }).then(detail => {
      if (!active || getStoredUser()?.id !== ownerId) return;
      const links: Record<string, string> = {};
      for (const status of completed) {
        const link = verifiedCompanyRecordingLink(detail.items, status.recordingId, status.occurrenceId);
        if (link) links[status.recordingId] = link;
      }
      setVerifiedRecordingLinks(links);
    }).catch(() => { if (active) setVerifiedRecordingLinks({}); });
    return () => { active = false; };
  }, [recordingReview, recordingMeetingId, user?.id, companyUpload.statuses]);
  useEffect(() => {
    if (recordingReview && recorder.preview && canLeaveRecordingReview(recorder.preview.recordingId, companyUpload.statuses))
      setIsRecordingsOpen(false);
  }, [recordingReview, recorder.preview, companyUpload.statuses]);
  const [recoverySetup, setRecoverySetup] = useState<RecoverySetup | null>(null);
  const recoveryOwner = useRef<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recordingLocked, setRecordingLocked] = useState(false);
  const lockedRecordingOwner = useRef<string | null>(null);
  const recoveryBusyRef = useRef(false);
  const retryWriter = useRef<LocalRecordingWriter | null>(null);
  const configureRecovery = (setup: RecoverySetup | null) => { recoveryOwner.current = setup?.ownerId ?? null; setRecoverySetup(setup); };
  useEffect(() => {
    let checking = false;
    const lock = () => {
      if (!recoveryOwner.current) return;
      if (recorder.hasRecording()) { lockedRecordingOwner.current = recoveryOwner.current; setRecordingLocked(true); setIsRecordingsOpen(false); }
      recoveryOwner.current = null; setRecoverySetup(null);
      retryWriter.current?.lock(); retryWriter.current = null;
      recorder.lockLocalRecovery();
    };
    const checkAccount = () => { if (recoveryOwner.current && getStoredUser()?.id !== recoveryOwner.current) lock(); };
    const timer = window.setInterval(checkAccount, 1000);
    const verify = window.setInterval(() => {
      if (!recoveryOwner.current || checking) return;
      const owner = recoveryOwner.current; checking = true;
      void trpc.auth.me.query().then(result => { if (recoveryOwner.current === owner && result.user.id !== owner) lock(); })
        .catch(() => { if (recoveryOwner.current === owner) lock(); }).finally(() => { checking = false; });
    }, 30000);
    window.addEventListener('storage', checkAccount);
    window.addEventListener('ylaam-session-removed', lock);
    return () => { window.clearInterval(timer); window.clearInterval(verify); window.removeEventListener('storage', checkAccount); window.removeEventListener('ylaam-session-removed', lock); retryWriter.current?.lock(); };
  }, []);
  const aiAgreedIds = aiStatus.state === 'off' ? [] : Object.keys(call.remoteStreams);
  const aiCaptureActive = meeting.inMeeting && isHost && call.isConnected && !aiCaptureFault && aiStatus.state === 'active' && aiStatus.requestedByUserId === user?.id;
  const transcript = useMeetingSummaryCapture(
    aiCaptureActive, meetingCode, sessionRef.current?.occurrenceId,
    aiStatus.state === 'off' ? undefined : aiStatus.requestId, aiAgreedIds,
    call.localStream, meeting.isMicOn, call.remoteStreams, call.remoteMicMuted,
    text => call.publishTranscript(text),
  );

  useEffect(() => {
    if (!meeting.inMeeting || aiStatus.state === 'off') {
      setAiNoticeVisible(false);
      return;
    }
    setAiNoticeVisible(true);
    const timer = window.setTimeout(() => setAiNoticeVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, [meeting.inMeeting, aiStatus.state, aiStatus.state === 'off' ? '' : aiStatus.requestId]);

  useEffect(() => {
    if (aiStatus.state !== 'active' || aiStatus.requestedByUserId !== user?.id) return;
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await trpc.meetings.aiCaptureHeartbeat.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, requestId: aiStatus.requestId });
        if (!cancelled) setAiCaptureFault(false);
      } catch {
        if (!cancelled) setAiCaptureFault(true);
      }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [aiStatus.state, aiStatus.state === 'off' ? '' : aiStatus.requestId, user?.id, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting || !sessionRef.current?.participantId) { setAiStatus({ state: 'off' }); return; }
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await trpc.meetings.aiStatus.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId: sessionRef.current?.participantId });
        if (!cancelled) { setAiStatus(status); setAiStatusError(''); }
      } catch {
        if (!cancelled) setAiStatusError('Unable to check transcription status. Retrying automatically.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [meeting.inMeeting, meetingCode, user?.id]);

  useEffect(() => {
    if (!meeting.inMeeting || !isOwner || !user?.id || !enableAiOnJoin || !sessionRef.current?.participantId) return;
    const key = `${meetingCode}:${sessionRef.current.occurrenceId || ''}:${sessionRef.current.participantId}`;
    if (aiStartedForSession.current === key) return;
    aiStartedForSession.current = key;
    void (async () => {
      setAiBusy(true); setAiCaptureFault(false);
      try {
        setAiError('');
        await trpc.meetings.requestAiTranscription.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
        setAiStatus(await trpc.meetings.aiStatus.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId: sessionRef.current?.participantId }));
        setAiError('');
      } catch (error) {
        setEnableAiOnJoin(false); aiStartedForSession.current = ''; setAiStatus({ state: 'off' });
        setAiError(error instanceof Error ? error.message : 'Could not enable AI transcription.');
      } finally { setAiBusy(false); }
    })();
  }, [meeting.inMeeting, isOwner, user?.id, enableAiOnJoin, meetingCode]);

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
      }
      else setSessionError('Unable to check your session. Please try again.');
    }).finally(() => {
      if (!cancelled) setCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, [sessionAttempt]);

  useEffect(() => meeting.syncParticipantAudio(call.remoteMicMuted), [call.remoteMicMuted]);
  useEffect(() => meeting.syncParticipantSpeaking(call.speakingLevels), [call.speakingLevels]);
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
    let cancelled = false;
    setCheckingMeeting(true);
    setMeetingError('');
    void trpc.meetings.getByCode.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId }).then(({ meeting: room }) => {
      if (cancelled) return;
      meeting.setMeetingTitle(room.title);
      setRecordingTimeZone(room.timeZone ?? null);
      setRecordingFolderId(room.recordingFolderId ?? null);
      setRecordingMeetingId(room.id);
      setRecordingAccessPolicy(room.recordingAccessPolicy);
      setIsOwner(getStoredUser()?.id === room.hostUserId);
      setIsHost(getStoredUser()?.id === room.hostUserId);
      if (room.recurrenceCancelledAt) setMeetingError('This meeting series has been cancelled.');
      else if (room.status === 'ended' && room.scheduleType !== 'reusable' && room.scheduleType !== 'recurring') setMeetingError('This meeting has ended.');
    }).catch(error => {
      if (!cancelled) setMeetingError(error?.data?.code === 'NOT_FOUND'
        ? 'Meeting not found. Check the meeting code with the host.'
        : 'Unable to load this meeting. Please try again.');
    }).finally(() => { if (!cancelled) setCheckingMeeting(false); });
    return () => { cancelled = true; };
  }, [meetingCode, user?.id, sessionAttempt]);

  useEffect(() => {
    if (meeting.inMeeting || admission !== 'idle') return;
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
    if (!meeting.inMeeting || (!isHost && !isOwner)) return;
    let cancelled = false;
    let checking = false;
    let controller: AbortController | undefined;
    const loadRequests = async () => {
      if (checking) return;
      checking = true;
      controller = new AbortController();
      let timeout = 0;
      try {
        const result = await Promise.race([
          trpc.meetings.pendingAdmissions.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId }, { signal: controller.signal }),
          new Promise<never>((_, reject) => {
            timeout = window.setTimeout(() => { controller?.abort(); reject(new Error('Join request check timed out')); }, 8000);
          }),
        ]);
        if (!cancelled) {
          const requests = [...new Map(result.requests.map(({ id, name }) => [id, { id, name }])).values()];
          const fresh = requests.filter(request => !previousJoinRequestIdsRef.current.has(request.id));
          if (fresh.length > 0) {
            setAdmissionNotice(fresh.length === 1 ? `${fresh[0].name} is waiting to join.` : `${fresh.length} people are waiting to join.`);
            window.setTimeout(() => setAdmissionNotice(''), 6000);
          }
          previousJoinRequestIdsRef.current = new Set(requests.map(request => request.id));
          setJoinRequests(requests);
          setAdmissionError('');
        }
      } catch {
        if (!cancelled) setAdmissionError('Unable to check join requests. Retrying automatically.');
      } finally {
        window.clearTimeout(timeout);
        checking = false;
      }
    };
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 750);
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer); };
  }, [isHost, isOwner, meeting.inMeeting, meetingCode]);

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
        setIsHost(result.participants.some(participant => participant.isSelf && participant.role === 'host'));
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
            leavingRef.current = true;
            const preserveRecording = recorder.hasRecording();
            setClosingForSummary(true);
            await recorder.stop();
            setClosingForSummary(false);
            forgetSession(meetingCode);
            stopAllCameraStreams();
            meeting.leaveMeeting();
            alert(status.sessionEnded || status.meeting.status === 'ended' ? 'The host ended the meeting.' : 'The host removed you from the meeting.');
            if (preserveRecording) { setRecordingReview(true); setIsRecordingsOpen(true); }
            else navigate('/');
          }
        } else {
          const { meeting: room } = await trpc.meetings.getByCode.query({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
          if (leavingRef.current) return;
          if (room.status === 'ended') {
            leavingRef.current = true;
            const preserveRecording = recorder.hasRecording();
            setClosingForSummary(true);
            await recorder.stop();
            setClosingForSummary(false);
            stopAllCameraStreams();
            meeting.leaveMeeting();
            alert('The meeting has ended.');
            if (preserveRecording) { setRecordingReview(true); setIsRecordingsOpen(true); }
            else navigate('/');
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
      const preserveRecording = recorder.hasRecording() || companyUpload.statuses.some(status => status.stage === 'completed');
      const wasRecording = recorder.isRecording && !manualRecordingStop.current;
      const finished = await recorder.stop();
      if (wasRecording && finished?.canonicalBlob && user?.id && recordingFolderId)
        void companyUpload.start(finished, meetingCode, user.id, false, recordingFolderId);
      const hadTranscription = aiStatus.state !== 'off';
      const speech = await transcript.finish();
      if (hadTranscription && isOwner) {
        await trpc.meetings.stopAiTranscription.mutate({ meetingCode, occurrenceId, requestId: aiStatus.requestId });
        setAiStatus({ state: 'off' });
      }
      if (end) {
        await trpc.meetings.end.mutate({ meetingCode, occurrenceId });
        forgetSession(meetingCode);
      } else {
        await trpc.meetings.leave.mutate({ meetingCode, occurrenceId, participantId: session?.participantId });
      }
      if (hadTranscription || speech.trim()) setSummaryReview({ speech, occurrenceId, warning: transcript.getWarning() });
      else if (preserveRecording) {
        setRecordingReview(true);
        setIsRecordingsOpen(!canLeaveRecordingReview(recorder.preview ? recorder.preview.recordingId : null, companyUpload.statuses));
      }
      else navigate('/');
      stopAllCameraStreams();
      meeting.leaveMeeting();
    } catch (error) {
      leavingRef.current = false;
      void transcript.resume();
      alert(error instanceof Error ? error.message : 'Unable to close the meeting. Please retry.');
    } finally { setClosingForSummary(false); }
  };

  const handleLeave = async () => {
    if (isHost || recorder.hasRecording()) { await closeWithSummary(false); return; }
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

  const promoteCohost = async (participantId: string) => {
    if (!isOwner || !window.confirm('Give this participant host controls for this meeting session?')) return;
    try {
      await trpc.meetings.promoteCohost.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to appoint co-host.');
    }
  };

  const stopAiTranscription = async () => {
    if (aiStatus.state === 'off' || aiBusy || !isHost) return;
    const requestId = aiStatus.requestId;
    setAiStatus({ state: 'off' });
    setAiBusy(true);
    try { await trpc.meetings.stopAiTranscription.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, requestId }); }
    catch (error) { alert(error instanceof Error ? error.message : 'Unable to stop transcription.'); }
    finally { setAiBusy(false); }
  };

  const respondToAiTranscription = async (agree: boolean) => {
    if (aiStatus.state === 'off' || aiBusy) return;
    setAiBusy(true); setAiError('');
    try {
      await trpc.meetings.respondAiTranscription.mutate({
        meetingCode, occurrenceId: sessionRef.current?.occurrenceId,
        participantId: sessionRef.current?.participantId, requestId: aiStatus.requestId, agree,
      });
      setAiStatus(await trpc.meetings.aiStatus.query({
        meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId: sessionRef.current?.participantId,
      }));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unable to save your transcription choice.');
    } finally { setAiBusy(false); }
  };

  const toggleRecording = async () => {
    if (!isHost || recorder.isFinalizing || leavingRef.current) return;
    if (recorder.isRecording) {
      manualRecordingStop.current = true;
      const finished = await recorder.stop();
      if (finished?.canonicalBlob && user?.id && recordingFolderId)
        void companyUpload.start(finished, meetingCode, user.id, false, recordingFolderId);
      return;
    }
    if (recorder.preview) { setIsRecordingsOpen(true); return; }
    try {
      const setup = recoverySetup && getStoredUser()?.id === recoverySetup.ownerId ? recoverySetup : null;
      setRecoverySetup(null);
      manualRecordingStop.current = false;
      await recorder.start(sessionRef.current?.occurrenceId, setup ?? undefined);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to start screen recording.');
    }
  };

  const retryLocalSave = async () => {
    const preview = recorder.preview, setup = recoverySetup;
    if (!preview || !setup || recoveryBusyRef.current || recordingLocked) return;
    recoveryBusyRef.current = true;
    setRecoveryBusy(true); setRecoveryMessage('Saving encrypted recording on this device...');
    try {
      const { user: verified } = await trpc.auth.me.query();
      if (verified.id !== setup.ownerId || getStoredUser()?.id !== setup.ownerId) throw new Error('Account changed.');
      const details = { meetingCode, occurrenceId: preview.occurrenceId, fileName: preview.fileName, mimeType: preview.mimeType, durationSeconds: preview.durationSeconds, canonicalEligible: Boolean(preview.canonicalBlob), uploadRecordingId: preview.recordingId, recordingStartedAt:preview.recordingStartedAt };
      const writer = await LocalRecordingWriter.create(setup.ownerId, setup.passphrase, details, () => setRecoveryMessage('Local save failed. Keep this page open and download the recording.'));
      retryWriter.current = writer;
      if (getStoredUser()?.id !== setup.ownerId || recoveryOwner.current !== setup.ownerId) { writer.lock(); throw new Error('Account changed.'); }
      // Save the same unmodified bytes used for future resumable uploads.
      writer.append(preview.canonicalBlob ?? preview.blob);
      if (!await writer.finish(details)) throw new Error('Local save failed.');
      setRecoveryMessage('Encrypted recording saved on this device.');
      setRecoverySetup(null);
    } catch { setRecoveryMessage('Local save failed. Keep this page open and download the recording.'); }
    finally { retryWriter.current = null; recoveryBusyRef.current = false; setRecoveryBusy(false); }
  };

  const uploadCompanyRecording = async (folderId: string | null, saveForFuture: boolean) => {
    const preview = recorder.preview;
    if (!preview?.canonicalBlob || !user?.id) return;
    if (saveForFuture) {
      if (!recordingMeetingId || !folderId) throw new Error('Choose an authorized folder to save for future occurrences.');
      const updated = await trpc.meetings.updateRecordingSettings.mutate({ meetingId: recordingMeetingId,
        recordingFolderId: folderId, recordingAccessPolicy });
      setRecordingFolderId(updated.meeting.recordingFolderId ?? null);
    }
    await companyUpload.start(preview, meetingCode, user.id, false, folderId);
  };

  const unlockRecordingPreview = async () => {
    try {
      const owner = lockedRecordingOwner.current;
      const { user: verified } = await trpc.auth.me.query();
      if (!owner || verified.id !== owner || getStoredUser()?.id !== owner) throw new Error();
      recoveryOwner.current = owner; lockedRecordingOwner.current = null; setRecordingLocked(false);
      if (recorder.preview) setIsRecordingsOpen(true);
      setRecoveryMessage('');
    } catch { setRecoveryMessage('Sign in as the recording owner to review this recording.'); }
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
    // Auth hydration can finish in the same render that enables the pre-join
    // action. Read the verified local identity as a fallback so a creator is
    // never treated as an anonymous guest during that transition.
    const authenticatedUser = user ?? getStoredUser();
    const displayName = meeting.displayName.trim();
    if (!displayName || joiningRef.current || admission === 'pending') return;
    joiningRef.current = true;
    setIsJoining(true);

    try {
      let { meeting: room } = await trpc.meetings.getByCode.query({ meetingCode });
      if (room.recurrenceCancelledAt) throw new Error('This meeting series has been cancelled.');
      if (room.status === 'ended' && room.scheduleType !== 'reusable' && room.scheduleType !== 'recurring') throw new Error('This meeting has ended.');
      if ((room.scheduleType === 'reusable' || room.scheduleType === 'recurring')) {
        if (!room.activeOccurrenceId && room.hostUserId === authenticatedUser?.id) {
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
          if (authenticatedUser && (!(error instanceof Error) || !error.message.includes('A new admission is required'))) throw error;
          joinRequestId = crypto.randomUUID();
          rememberSession(meeting.meetingCode, { displayName, occurrenceId: sessionRef.current?.occurrenceId, joinRequestId });
          const joined = await trpc.meetings.join.mutate({
            meetingCode: meeting.meetingCode,
            occurrenceId: sessionRef.current?.occurrenceId,
            joinRequestId,
            ...(!authenticatedUser ? { guestName: displayName } : {}),
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
          ...(!authenticatedUser ? { guestName: displayName } : {}),
        });
        rememberSession(meeting.meetingCode, {
          displayName,
          occurrenceId: joined.participant.occurrenceId ?? undefined,
          participantId: joined.participant.id,
          joinRequestId,
        });
        if (joined.participant.admission === 'admitted') meeting.joinMeeting();
        else setAdmission(joined.participant.admission === 'denied' ? 'denied' : 'pending');
      }
    } catch (error) {
      joiningRef.current = false;
      setIsJoining(false);
      setMeetingError(error instanceof Error ? error.message : 'Unable to join the meeting.');
    }
  };

  const decideAdmission = async (participantId: string, admit: boolean) => {
    if (admissionActionsRef.current.has(participantId)) return;
    admissionActionsRef.current.add(participantId);
    setAdmissionActionError('');
    setAdmissionActions((current) => new Set(current).add(participantId));
    try {
      await trpc.meetings.decideAdmission.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId, participantId, admit });
      setJoinRequests((requests) => requests.filter((request) => request.id !== participantId));
    } catch {
      setAdmissionActionError('Unable to update the join request. Please try again.');
    } finally {
      admissionActionsRef.current.delete(participantId);
      setAdmissionActions((current) => {
        const next = new Set(current);
        next.delete(participantId);
        return next;
      });
    }
  };

  const admitAll = async () => {
    if (admissionActionsRef.current.has('__all__')) return;
    admissionActionsRef.current.add('__all__');
    setAdmissionActions((current) => new Set(current).add('__all__'));
    setAdmissionActionError('');
    try {
      const result = await trpc.meetings.admitAll.mutate({ meetingCode, occurrenceId: sessionRef.current?.occurrenceId });
      const admitted = new Set(result.participantIds);
      setJoinRequests((requests) => requests.filter((request) => !admitted.has(request.id)));
    } catch {
      setAdmissionActionError('Unable to admit all join requests. Please try again.');
    } finally {
      admissionActionsRef.current.delete('__all__');
      setAdmissionActions((current) => {
        const next = new Set(current);
        next.delete('__all__');
        return next;
      });
    }
  };

  const renderScreen = () => {
  if (recordingReview) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
    <section className="max-w-lg space-y-4 rounded-[8px] border border-white/10 bg-slate-900 p-6">
      <h1 className="text-xl font-semibold">Review your recording</h1>
      {(recorder.preview && canLeaveRecordingReview(recorder.preview.recordingId, companyUpload.statuses)) ||
        (!recorder.preview && companyUpload.statuses.some(status => status.stage === 'completed'))
        ? <p>Recording saved successfully.</p>
        : <><p>Your meeting has closed. Keep this page open until you have saved or explicitly discarded your recording.</p>
          <p className="text-sm text-slate-400">Keep this page open until local recovery completes or you download the recording. Company upload depends on availability.</p></>}
      {!recordingLocked && companyUpload.statuses.filter(status => status.stage === 'completed').map(status =>
        <div key={status.recordingId} className="min-w-0 space-y-2 text-sm">
          <p className="truncate font-semibold" title={status.fileName}>{status.fileName}</p>
          {verifiedRecordingLinks[status.recordingId]
            ? <div className="flex min-w-0 items-center gap-2">
                <a className="min-w-0 flex-1 truncate text-blue-300 underline" href={verifiedRecordingLinks[status.recordingId]} target="_blank" rel="noopener noreferrer" title={verifiedRecordingLinks[status.recordingId]}>{verifiedRecordingLinks[status.recordingId]}</a>
                <button type="button" aria-label={copiedRecordingLink === status.recordingId ? 'Recording link copied' : 'Copy recording link'} title={copiedRecordingLink === status.recordingId ? 'Recording link copied' : 'Copy recording link'} className="shrink-0 rounded-[8px] border border-white/10 p-2" onClick={() => {
                  void navigator.clipboard.writeText(verifiedRecordingLinks[status.recordingId]).then(
                    () => { setCopiedRecordingLink(status.recordingId); setRecordingLinkNotice(''); },
                    () => { setCopiedRecordingLink(null); setRecordingLinkNotice('Could not copy the link. Select it above to copy manually.'); });
                }}>{copiedRecordingLink === status.recordingId
                  ? <Check aria-hidden="true" className="h-4 w-4 text-green-400" />
                  : <Copy aria-hidden="true" className="h-4 w-4" />}</button>
              </div>
            : <p className="text-slate-400">The verified Drive link is temporarily unavailable. You can leave and find the recording in Meeting History later.</p>}
        </div>)}
      {recordingLinkNotice && <p role="status" className="text-sm">{recordingLinkNotice}</p>}
      {recorder.localStatus && <p role="status" className="text-sm">{recorder.localStatus}</p>}
      {recoveryMessage && <p role="status" className="text-sm">{recoveryMessage}</p>}
      {recordingLocked && <><p role="alert" className="text-sm">Recording preview is hidden because the account session changed.</p><button className="rounded-[8px] border border-white/10 px-4 py-2" onClick={() => void unlockRecordingPreview()}>Verify recording owner</button></>}
      {recorder.preview && !recordingLocked && <LocalRecoverySetup meetingCode={meetingCode} active={Boolean(recoverySetup)} disabled={recoveryBusy} onChange={configureRecovery} />}
      {recorder.preview && recoverySetup && !recordingLocked && <button disabled={recoveryBusy} className="rounded-[8px] border border-white/10 px-4 py-2" onClick={() => void retryLocalSave()}>Save encrypted copy on this device</button>}
      {recorder.error && <p role="alert">{recorder.error}</p>}
      {recorder.preview && !recordingLocked && <button className="rounded-[8px] bg-violet-600 px-4 py-2" onClick={() => setIsRecordingsOpen(true)}>Save / Download Recording</button>}
      <button onClick={() => {
        if (recordingLocked) { if (window.confirm('Leaving will discard the in-page preview. Continue?')) navigate('/'); return; }
        if (!canLeaveRecordingReview(recorder.preview ? recorder.preview.recordingId : null, companyUpload.statuses)) { setIsRecordingsOpen(true); return; }
        recorder.clearPreview(); navigate('/');
      }} className="rounded-[8px] bg-red-600 px-4 py-2 text-white hover:bg-red-700">{recordingLocked ? 'Leave review' : recorder.preview
        ? canLeaveRecordingReview(recorder.preview.recordingId, companyUpload.statuses) ? 'Leave Meeting' : 'Review before leaving'
        : companyUpload.statuses.some(status => status.stage === 'completed') ? 'Leave Meeting' : 'Return home'}</button>
    </section>
  </div>;
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
      speech={summaryReview.speech} warning={summaryReview.warning} onClose={() => { if (recorder.hasRecording() || companyUpload.statuses.some(status => status.stage === 'completed')) {
        setSummaryReview(null); setRecordingReview(true);
        setIsRecordingsOpen(!canLeaveRecordingReview(recorder.preview ? recorder.preview.recordingId : null, companyUpload.statuses));
      } else navigate('/'); }}
      onOpenRecordings={recorder.preview ? () => setIsRecordingsOpen(true) : undefined} />
  </>;

  if (!meeting.inMeeting) {
    return (
      <>
      <WaitingRoom
        accountEmail={user?.email}
        checkingSession={checkingSession || checkingMeeting}
        sessionError={sessionError || meetingError}
        onRetrySession={() => setSessionAttempt((attempt) => attempt + 1)}
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
        isHost={isOwner}
        enableAiTranscription={enableAiOnJoin}
        onEnableAiTranscriptionChange={setEnableAiOnJoin}
      />
      </>
    );
  }

  return (
    <div className="w-full h-screen bg-[#070a18] text-slate-800 flex flex-col justify-start overflow-hidden relative select-none font-sans">
      {recorder.error && <p role="alert" className="relative z-50 rounded-[8px] border border-white/10 bg-slate-900 p-3 text-white">{recorder.error}</p>}
      {recorder.localStatus && <p role="status" className="relative z-40 px-4 text-xs text-slate-300">{recorder.localStatus}</p>}
      {recordingLocked && <p role="alert" className="relative z-40 px-4 text-xs text-slate-300">Recording preview is hidden because the account session changed. <button className="rounded-[8px] underline" onClick={() => void unlockRecordingPreview()}>Verify recording owner</button>{recoveryMessage && ` ${recoveryMessage}`}</p>}
      {recorder.isRecording && <p role="status" className="relative z-40 text-xs text-slate-300 px-4">Recording is local to your browser. A notice is sent to connected participants, but consent is not collected. Tell participants before recording. Remote audio depends on the selected tab/screen and shared audio.</p>}
      {meeting.participants.filter(participant => participant.id !== 'user-self' && participant.role === 'host').map(participant => {
        const notice = call.recordingNotices[participant.id];
        return notice && notice.state !== 'stopped' ? <p key={participant.id} role="status" className="relative z-40 px-4 text-xs text-slate-300">{participant.name} reports recording is {notice.state === 'paused' ? 'paused' : 'active'}. This notice does not record consent.</p> : null;
      })}
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
      {(isHost || isOwner) && (admissionError || admissionActionError) && (
        <div role="alert" className="fixed left-1/2 top-4 z-[120] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-xl">{admissionActionError || admissionError}</div>
      )}
      {(isHost || isOwner) && admissionNotice && (
        <div role="status" className="fixed right-5 top-5 z-[120] rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-xl">{admissionNotice}</div>
      )}
      {(isHost || isOwner) && joinRequests.length > 0 && (
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
              {joinRequests.length > 1 && (
                <button type="button" onClick={() => void admitAll()} disabled={admissionActionsRef.current.has('__all__')} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50">
                  {admissionActionsRef.current.has('__all__') ? 'Admitting...' : `Admit All (${joinRequests.length})`}
                </button>
              )}
              {joinRequests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="truncate text-base font-semibold text-slate-900">{request.name}</p>
                    <button type="button" disabled={admissionActions.has(request.id)} onClick={() => void decideAdmission(request.id, true)} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-50">{admissionActions.has(request.id) ? '...' : 'Admit'}</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button disabled={admissionActions.has(request.id)} onClick={() => void decideAdmission(request.id, false)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50">
                      <X className="h-4 w-4" /> {admissionActions.has(request.id) ? 'Processing...' : 'Deny'}
                    </button>
                    <button type="button" disabled={admissionActions.has(request.id)} onClick={() => void decideAdmission(request.id, true)} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-50">
                      <Check className="h-4 w-4" /> {admissionActions.has(request.id) ? 'Processing...' : 'Admit participant'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
        isRecordingPaused={recorder.isPaused}
        onToggleRecordingPause={recorder.isPaused ? recorder.resume : recorder.pause}
        onOpenInfo={() => meeting.setIsInfoOpen(true)}
        onOpenLeave={() => meeting.setIsLeaveModalOpen(true)}
        layoutMode={meeting.layoutMode}
        onChangeLayout={meeting.setLayoutMode}
        inviteLink={meeting.meetingInfo.inviteLink}
        isHost={isHost}
        onEndMeeting={() => void handleEndMeeting()}
      />

      <div className="relative z-40 shrink-0 px-3 sm:px-4 pt-2 flex items-center gap-2">
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
        {isHost && <LocalRecoverySetup meetingCode={meetingCode} active={Boolean(recoverySetup)} disabled={recorder.isRecording || recorder.isFinalizing} onChange={configureRecovery} />}
        {aiStatus.state !== 'off' && <>
          <span className="rounded-lg bg-slate-900/80 px-2 py-1 text-xs text-white">
            {aiStatus.state === 'pending' ? 'AI transcription awaiting consent' : aiStatus.capturing && !aiCaptureFault && transcript.capturing ? 'AI transcription active' : 'AI transcription preparing'}
          </span>
          {isHost && <button type="button" disabled={aiBusy} onClick={() => void stopAiTranscription()} className="rounded-lg bg-slate-900/80 px-2 py-1 text-xs text-white underline disabled:opacity-50">Stop transcription</button>}
        </>}
      </div>

      {/* MAIN CONTENT AREA: Left Panel + Video Stage + Right Sidebar */}
      <div className="flex-1 min-h-0 w-full flex items-stretch overflow-hidden relative px-3 sm:px-4 py-1 gap-3 sm:gap-4">
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



      {(closingForSummary || recorder.isFinalizing) && <div role="status" className="fixed inset-0 z-[110] bg-black/80 text-white flex items-center justify-center">Finalizing recording and finishing meeting audio...</div>}
      {(aiNoticeVisible && aiStatus.state !== 'off' || aiStatus.state !== 'off' && aiStatus.needsResponse || aiError || aiStatusError || aiCaptureFault || transcript.error) &&
      <div className="fixed bottom-24 left-4 z-30 max-w-sm rounded-lg bg-zinc-900/95 p-3 text-xs text-white shadow-lg" role="status">
        {aiNoticeVisible && aiStatus.state !== 'off' &&
          <p className="font-semibold">{aiStatus.state === 'pending'
            ? `Waiting for participant consent${aiStatus.pending ? ` (${aiStatus.pending} remaining)` : ''}.`
            : aiStatus.capturing && !aiCaptureFault && transcript.capturing
              ? 'AI transcription active. Meeting audio is processed by YLAAM Meet and OpenAI; transcript text is saved in the host’s Meeting History.'
              : 'AI transcription is enabled and preparing capture.'}</p>
        }
        {aiStatus.state !== 'off' && aiStatus.needsResponse && <>
          {!aiNoticeVisible && <p>AI transcription requires your consent.</p>}
          <div className="mt-2 flex gap-3">
            <button type="button" disabled={aiBusy} onClick={() => void respondToAiTranscription(true)} className="underline">Agree</button>
            <button type="button" disabled={aiBusy} onClick={() => void respondToAiTranscription(false)} className="underline">Decline</button>
          </div>
        </>}
        {aiError && <p role="alert" className="mt-1 text-amber-200">{aiError}</p>}
        {aiStatusError && <p role="alert" className="mt-1 text-amber-200">{aiStatusError}</p>}
        {aiCaptureFault && <p role="alert" className="mt-1 text-amber-200">Capture stopped after a permission check failed. Stop and request transcription again.</p>}
        {transcript.error && <p role="alert" className="mt-1 text-amber-200">{transcript.error}</p>}
      </div>}


        {/* CENTER VIDEO GRID & STAGE */}
        <div className="flex-1 min-w-0 h-full min-h-0 overflow-hidden flex flex-col relative">
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
            remoteScreenStreams={call.remoteScreenStreams}
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
          <div className="w-[min(44vw,20rem)] sm:w-72 md:w-80 max-w-[44%] h-full min-h-0 flex-shrink-0 z-30 transition-all duration-300 animate-slideLeft">
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
                onPromoteCohost={isOwner ? (participantId) => void promoteCohost(participantId) : undefined}
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
                  <section className="rounded-2xl border border-blue-100 bg-white/80 p-4" aria-label="AI transcript">
                    <h3 className="font-bold text-sm text-slate-900">AI transcript</h3>
                    <p className="mt-1 text-xs text-slate-600">Automatic text may contain errors. Mixed audio does not identify individual speakers.</p>
                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto" aria-live="polite">
                      {call.transcriptSegments.length ? call.transcriptSegments.map(segment =>
                        <p key={segment.id} className="break-words text-sm text-slate-800"><span className="text-xs text-slate-500">{segment.timestamp}</span> {segment.text}</p>
                      ) : <p className="text-sm text-slate-500">No transcript text yet.</p>}
                    </div>
                  </section>
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
  return <>{renderScreen()}<RecordingsModal
    isOpen={isRecordingsOpen && !recorder.isFinalizing && !recordingLocked}
    meetingCode={meetingCode} preview={recordingLocked ? null : recorder.preview}
    allowUpload={Boolean(recorder.preview?.canonicalBlob)}
    companyUploads={recordingLocked ? [] : companyUpload.statuses} onCompanyRetry={companyUpload.retry}
    savedFolderId={recordingFolderId}
    onCompanyUpload={recorder.preview?.canonicalBlob && user?.id ? uploadCompanyRecording : undefined}
    onClose={() => setIsRecordingsOpen(false)} onDiscardPreview={recorder.clearPreview}
  /></>;
};
