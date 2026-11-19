'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Participant,
  ChatMessage,
  SidebarTab,
  LayoutMode,
  DeviceSettings,
  Poll,
} from '@/types/meeting';
import {
  DEFAULT_MEETING_INFO,
} from '@/utils/meetingHelpers';
import { getStoredUser } from '@/lib/auth';
import { getMeetingSession, storeMeetingSession } from '@/lib/meetingSession';

export function useMeeting(initialMeetingCode: string = 'YLM-9284-XKP') {
  const initialSession = getMeetingSession(initialMeetingCode);
  const authenticatedUser = getStoredUser();
  const initialDisplayName = initialSession?.displayName || authenticatedUser?.fullName || 'Guest User';
  // Meeting metadata
  const [meetingCode] = useState<string>(initialMeetingCode);
  const [meetingTitle, setMeetingTitle] = useState<string>('YLAAM-MEET');
  const [inMeeting, setInMeeting] = useState<boolean>(false); // Starts in waiting room or in meeting
  
  // Timers
  const [durationSeconds, setDurationSeconds] = useState<number>(1455); // ~24 min default
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingMs, setRecordingMs] = useState<number>(0);

  // Local User Controls
  // Media is opt-in for every participant. Only the local mic/camera controls
  // may change these values to true.
  const [isMicOn, setIsMicOn] = useState<boolean>(false);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isHandRaised, setIsHandRaised] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState<boolean>(false);

  // Participants & Speaker
  const [displayName, setDisplayNameState] = useState<string>(initialDisplayName);
  const [participants, setParticipants] = useState<Participant[]>([{
    id: 'user-self',
    name: initialDisplayName,
    avatar: 'https://api.dicebear.com/9.x/initials/svg?seed=You',
    // The roster sync assigns the real role. Defaulting every signed-in user
    // to 'host' made non-owners briefly see a HOST badge on their own tile.
    role: 'attendee',
    isMuted: true,
    isCameraOn: false,
    isSpeaking: false,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'excellent',
    audioLevel: 0,
  }]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>('user-self');
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);

  // Sidebar & Modals
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('speaker');

  // Chat & Polls
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);

  // Devices & Audio Settings
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(() => {
    let saved: Partial<{ micDevice: string; camDevice: string; speakerDevice: string }> = {};
    try { saved = JSON.parse(window.localStorage.getItem('ylaam-device-settings') || '{}'); } catch { /* ignore invalid local settings */ }
    return {
    micId: saved.micDevice || 'default',
    cameraId: saved.camDevice || 'default',
    speakerId: saved.speakerDevice || 'default-speaker',
    noiseCancellation: true,
    backgroundBlur: 'none',
    resolution: '1080p',
    };
  });

  // Timer tick effect
  useEffect(() => {
    if (!inMeeting) return;
    const interval = setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [inMeeting]);

  // Recording timer tick (milliseconds)
  useEffect(() => {
    if (!isRecording || !inMeeting) {
      setRecordingMs(0);
      return;
    }
    const startTime = Date.now();
    const interval = setInterval(() => {
      setRecordingMs(Date.now() - startTime);
    }, 30);
    return () => clearInterval(interval);
  }, [isRecording, inMeeting]);

  // Preserve the actual audio levels separately while selecting a speaker.
  const syncSpeakers = useCallback((activeIds: string[]) => {
    const first = activeIds.find((id) => id !== 'user-self') ?? activeIds[0];
    if (first) setActiveSpeakerId(first);
  }, []);

  // Toggle Handlers
  const toggleMic = useCallback(() => {
    setIsMicOn((prev) => {
      const next = !prev;
      setParticipants((list) =>
        list.map((p) => (p.id === 'user-self' ? { ...p, isMuted: !next, isSpeaking: next ? p.isSpeaking : false, audioLevel: next ? p.audioLevel : 0 } : p))
      );
      return next;
    });
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    setIsMicOn(enabled);
    setParticipants((list) =>
      list.map((p) => (p.id === 'user-self' ? { ...p, isMuted: !enabled, isSpeaking: enabled ? p.isSpeaking : false, audioLevel: enabled ? p.audioLevel : 0 } : p))
    );
  }, []);

  const setDisplayName = useCallback(
    (name: string) => {
      setDisplayNameState(name);
      setParticipants((list) =>
        list.map((participant) =>
          participant.id === 'user-self' ? { ...participant, name: name || 'Guest User' } : participant
        )
      );
      storeMeetingSession(meetingCode, {
        ...getMeetingSession(meetingCode),
        displayName: name,
      });
    },
    [meetingCode]
  );

  const toggleCamera = useCallback(() => {
    setIsCameraOn((prev) => {
      const next = !prev;
      setParticipants((list) =>
        list.map((p) => (p.id === 'user-self' ? { ...p, isCameraOn: next } : p))
      );
      return next;
    });
  }, []);

  const toggleHandRaised = useCallback(() => {
    setIsHandRaised((prev) => {
      const next = !prev;
      setParticipants((list) =>
        list.map((p) => (p.id === 'user-self' ? { ...p, isHandRaised: next } : p))
      );
      return next;
    });
  }, []);

  const startScreenSharing = useCallback((title: string = 'YLAAM-MEET BIM Studio v4') => {
    setIsScreenSharing(true);
    setParticipants((list) =>
      list.map((p) =>
        p.id === 'user-self'
          ? { ...p, isScreenSharing: true, sharedScreenTitle: title }
          : p
      )
    );
    setActiveSpeakerId('user-self');
  }, []);

  const stopScreenSharing = useCallback(() => {
    setIsScreenSharing(false);
    setParticipants((list) =>
      list.map((p) =>
        p.id === 'user-self' ? { ...p, isScreenSharing: false } : p
      )
    );
  }, []);

  const toggleScreenSharing = useCallback(
    (title: string = 'YLAAM-MEET BIM Studio v4') => {
      if (isScreenSharing) {
        stopScreenSharing();
      } else {
        startScreenSharing(title);
      }
    },
    [isScreenSharing, startScreenSharing, stopScreenSharing]
  );

  const toggleRecording = useCallback(() => {
    setIsRecording((prev) => !prev);
  }, []);

  const togglePinParticipant = useCallback((participantId: string) => {
    setPinnedParticipantId((curr) => (curr === participantId ? null : participantId));
    setActiveSpeakerId(participantId);
  }, []);

  const toggleMuteParticipant = useCallback((participantId: string) => {
    if (participantId !== 'user-self') return;
    toggleMic();
  }, [toggleMic]);

  const syncParticipantAudio = useCallback((mutedById: Record<string, boolean>) => {
    setParticipants((list) =>
      list.map((p) => p.id !== 'user-self' && mutedById[p.id] !== undefined
        ? { ...p, isMuted: mutedById[p.id], isSpeaking: mutedById[p.id] ? false : p.isSpeaking, audioLevel: mutedById[p.id] ? 0 : p.audioLevel }
        : p)
    );
  }, []);

  const syncParticipantSpeaking = useCallback((levelsById: Record<string, number>) => {
    setParticipants((list) => list.map((p) => ({
      ...p,
      isSpeaking: !p.isMuted && levelsById[p.id] !== undefined,
      audioLevel: !p.isMuted ? levelsById[p.id] ?? 0 : 0,
    })));
  }, []);

  const syncParticipantVideo = useCallback((cameraById: Record<string, boolean>) => {
    setParticipants((list) => list.map((p) => p.id !== 'user-self' && cameraById[p.id] !== undefined
      ? { ...p, isCameraOn: cameraById[p.id] }
      : p));
  }, []);

  const setCameraEnabled = useCallback((enabled: boolean) => {
    setIsCameraOn(enabled);
    setParticipants((list) => list.map((p) => p.id === 'user-self' ? { ...p, isCameraOn: enabled } : p));
  }, []);

  const syncParticipants = useCallback((roster: Array<{ id: string; name: string; role: 'host' | 'participant'; isSelf: boolean }>) => {
    setParticipants((current) => roster.map((entry) => {
      const id = entry.isSelf ? 'user-self' : entry.id;
      const existing = current.find((participant) => participant.id === id);
      return {
        id,
        name: entry.name,
        avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(entry.name)}`,
        role: entry.role === 'host' ? 'host' : 'attendee',
        // Media mute state is synchronized separately from LiveKit. Roster
        // polling must not overwrite it with stale identity-only data.
        isMuted: existing?.isMuted ?? true,
        isCameraOn: existing?.isCameraOn ?? false,
        isSpeaking: existing?.isSpeaking ?? false,
        isHandRaised: existing?.isHandRaised ?? false,
        isPinned: existing?.isPinned ?? false,
        isScreenSharing: existing?.isScreenSharing ?? false,
        connectionQuality: existing?.connectionQuality ?? 'excellent',
        audioLevel: existing?.audioLevel ?? 0,
      };
    }));
  }, []);

  const toggleSidebarTab = useCallback((tab: SidebarTab) => {
    setActiveSidebarTab((curr) => (curr === tab ? null : tab));
  }, []);

  const sendMessage = useCallback((text: string, fileAttachment?: ChatMessage['fileAttachment']) => {
    if (!text.trim() && !fileAttachment) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user-self',
      senderName: `${displayName} (You)`,
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      message: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHost: true,
      fileAttachment,
    };
    setMessages((prev) => [...prev, newMsg]);
  }, [displayName]);

  const votePoll = useCallback((pollId: string, optionId: string) => {
    setPolls((prev) =>
      prev.map((poll) => {
        if (poll.id !== pollId || poll.hasVoted) return poll;
        return {
          ...poll,
          hasVoted: true,
          totalVotes: poll.totalVotes + 1,
          options: poll.options.map((opt) =>
            opt.id === optionId ? { ...opt, votes: opt.votes + 1 } : opt
          ),
        };
      })
    );
  }, []);

  const joinMeeting = useCallback(() => {
    setInMeeting(true);
  }, []);

  const leaveMeeting = useCallback(() => {
    setInMeeting(false);
    setIsLeaveModalOpen(false);
  }, []);

  return {
    meetingCode,
    meetingTitle,
    setMeetingTitle,
    displayName,
    setDisplayName,
    meetingInfo: {
      ...DEFAULT_MEETING_INFO,
      meetingId: meetingCode,
      title: meetingTitle,
      inviteLink: `${window.location.origin}/meet/${meetingCode}`,
    },
    inMeeting,
    joinMeeting,
    leaveMeeting,
    durationSeconds,
    isRecording,
    recordingMs,
    toggleRecording,
    
    // Controls
    isMicOn,
    toggleMic,
    setMicEnabled,
    isCameraOn,
    toggleCamera,
    setCameraEnabled,
    isHandRaised,
    toggleHandRaised,
    isScreenSharing,
    toggleScreenSharing,
    startScreenSharing,
    stopScreenSharing,
    isWhiteboardOpen,
    setIsWhiteboardOpen,

    // Participants & Speaker
    participants,
    activeSpeakerId,
    setActiveSpeakerId,
    pinnedParticipantId,
    togglePinParticipant,
    toggleMuteParticipant,
    syncParticipantAudio,
    syncParticipantSpeaking,
    syncParticipantVideo,
    syncParticipants,
    syncSpeakers,

    // Layout & Sidebar
    layoutMode,
    setLayoutMode,
    activeSidebarTab,
    toggleSidebarTab,

    // Modals
    isSettingsOpen,
    setIsSettingsOpen,
    isInfoOpen,
    setIsInfoOpen,
    isLeaveModalOpen,
    setIsLeaveModalOpen,

    // Chat & Polls
    messages,
    sendMessage,
    polls,
    votePoll,

    // Devices
    deviceSettings,
    setDeviceSettings,
  };
}
