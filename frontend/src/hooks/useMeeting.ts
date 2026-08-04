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
  DUMMY_PARTICIPANTS,
  DUMMY_MESSAGES,
  DUMMY_POLLS,
  DEFAULT_MEETING_INFO,
} from '@/utils/meetingHelpers';

export function useMeeting(initialMeetingCode: string = 'arch-9284-xkp') {
  // Meeting metadata
  const [meetingCode] = useState<string>(initialMeetingCode);
  const [meetingTitle, setMeetingTitle] = useState<string>('ARCHROOM');
  const [inMeeting, setInMeeting] = useState<boolean>(false); // Starts in waiting room or in meeting
  
  // Timers
  const [durationSeconds, setDurationSeconds] = useState<number>(1455); // ~24 min default
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingMs, setRecordingMs] = useState<number>(0);

  // Local User Controls
  const [isMicOn, setIsMicOn] = useState<boolean>(true);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(true);
  const [isHandRaised, setIsHandRaised] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState<boolean>(false);

  // Participants & Speaker
  const [participants, setParticipants] = useState<Participant[]>(DUMMY_PARTICIPANTS);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>('user-self');
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);

  // Sidebar & Modals
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState<boolean>(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('speaker');

  // Chat & Polls
  const [messages, setMessages] = useState<ChatMessage[]>(DUMMY_MESSAGES);
  const [polls, setPolls] = useState<Poll[]>(DUMMY_POLLS);

  // Devices & Audio Settings
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>({
    micId: 'default-mic',
    cameraId: 'default-camera',
    speakerId: 'default-speaker',
    noiseCancellation: true,
    backgroundBlur: 'blur',
    resolution: '1080p',
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

  // Audio equalizer level animation simulation for active speaking
  useEffect(() => {
    if (!inMeeting) return;
    const interval = setInterval(() => {
      setParticipants((prev) =>
        prev.map((p) => {
          if (p.isMuted) return { ...p, isSpeaking: false, audioLevel: 0 };
          const isMain = p.id === activeSpeakerId || p.id === 'user-self';
          const randomLevel = isMain ? Math.floor(Math.random() * 60) + 30 : Math.floor(Math.random() * 20);
          return {
            ...p,
            isSpeaking: randomLevel > 25,
            audioLevel: randomLevel,
          };
        })
      );
    }, 600);
    return () => clearInterval(interval);
  }, [inMeeting, activeSpeakerId]);

  // Toggle Handlers
  const toggleMic = useCallback(() => {
    setIsMicOn((prev) => {
      const next = !prev;
      setParticipants((list) =>
        list.map((p) => (p.id === 'user-self' ? { ...p, isMuted: !next } : p))
      );
      return next;
    });
  }, []);

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

  const startScreenSharing = useCallback((title: string = 'ArchRoom BIM Studio v4') => {
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
    (title: string = 'ArchRoom BIM Studio v4') => {
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
    setParticipants((list) =>
      list.map((p) => (p.id === participantId ? { ...p, isMuted: !p.isMuted } : p))
    );
  }, []);

  const toggleSidebarTab = useCallback((tab: SidebarTab) => {
    setActiveSidebarTab((curr) => (curr === tab ? null : tab));
  }, []);

  const sendMessage = useCallback((text: string, fileAttachment?: ChatMessage['fileAttachment']) => {
    if (!text.trim() && !fileAttachment) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user-self',
      senderName: 'Alex Rivera (You)',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
      message: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHost: true,
      fileAttachment,
    };
    setMessages((prev) => [...prev, newMsg]);
  }, []);

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
    meetingInfo: { ...DEFAULT_MEETING_INFO, meetingId: meetingCode, title: meetingTitle },
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
    isCameraOn,
    toggleCamera,
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
