'use client';

import React, { useEffect, useState } from 'react';
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
import { ScreenShareModal } from './ScreenShareModal';
import { WaitingRoom } from './WaitingRoom';
import { stopAllCameraStreams } from './CameraVideo';
import { Whiteboard } from './Whiteboard';
import {
  PenTool,
  X,
  PhoneOff,
  BarChart3,
  Check,
  Clock3,
  UserCheck,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { getMeetingSession, storeMeetingSession } from '@/lib/meetingSession';
import { useSharedWhiteboard } from '@/hooks/useSharedWhiteboard';
import { getStoredUser } from '@/lib/auth';

interface MeetingRoomProps {
  meetingCode?: string;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode = 'YLM-9284-XKP',
}) => {
  const navigate = useNavigate();
  const meeting = useMeeting(meetingCode);
  const sharedWhiteboard = useSharedWhiteboard(meetingCode, meeting.inMeeting);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState<boolean>(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState<boolean>(false);
  const [admission, setAdmission] = useState<'idle' | 'pending' | 'denied'>('idle');
  const [isHost, setIsHost] = useState(false);
  const [joinRequests, setJoinRequests] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void trpc.meetings.getByCode.query({ meetingCode }).then(({ meeting: room }) => {
      meeting.setMeetingTitle(room.title);
      setIsHost(getStoredUser()?.id === room.hostUserId);
    }).catch(() => undefined);
  }, [meetingCode]);

  useEffect(() => {
    if (admission !== 'pending') return;
    const session = getMeetingSession(meetingCode);
    if (!session?.participantId) return;

    const checkAdmission = async () => {
      try {
        const result = await trpc.meetings.admissionStatus.query({
          meetingCode,
          participantId: session.participantId!,
        });
        if (result.admission === 'admitted') {
          setAdmission('idle');
          meeting.joinMeeting();
        } else if (result.admission === 'denied') {
          setAdmission('denied');
        }
      } catch {
        setAdmission('denied');
      }
    };

    void checkAdmission();
    const timer = window.setInterval(() => void checkAdmission(), 2000);
    return () => window.clearInterval(timer);
  }, [admission, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting || !isHost) return;
    const loadRequests = async () => {
      try {
        const result = await trpc.meetings.pendingAdmissions.query({ meetingCode });
        setJoinRequests(result.requests.map(({ id, name }) => ({ id, name })));
      } catch {
        setJoinRequests([]);
      }
    };
    void loadRequests();
    const timer = window.setInterval(() => void loadRequests(), 2000);
    return () => window.clearInterval(timer);
  }, [isHost, meeting.inMeeting, meetingCode]);

  useEffect(() => {
    if (!meeting.inMeeting) return;
    const loadParticipants = async () => {
      try {
        const session = getMeetingSession(meetingCode);
        const result = await trpc.meetings.participants.query({
          meetingCode,
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

  const handleLeave = () => {
    stopAllCameraStreams();
    meeting.leaveMeeting();
    navigate('/');
  };

  const handleJoin = async () => {
    const displayName = meeting.displayName.trim();
    if (!displayName) return;

    try {
      const existingSession = getMeetingSession(meeting.meetingCode);

      if (existingSession?.participantId) {
        try {
          await trpc.meetings.updateGuestName.mutate({
            meetingCode: meeting.meetingCode,
            participantId: existingSession.participantId,
            guestName: displayName,
          });
        } catch {
          // Registered users store their name on the user account, not guest_name.
        }
        const status = await trpc.meetings.admissionStatus.query({
          meetingCode: meeting.meetingCode,
          participantId: existingSession.participantId,
        });
        if (status.admission === 'admitted') meeting.joinMeeting();
        else setAdmission(status.admission === 'denied' ? 'denied' : 'pending');
      } else {
        const joined = await trpc.meetings.join.mutate({
          meetingCode: meeting.meetingCode,
          guestName: displayName,
        });
        storeMeetingSession(meeting.meetingCode, {
          displayName,
          participantId: joined.participant.id,
        });
        if (joined.participant.admission === 'admitted') meeting.joinMeeting();
        else setAdmission('pending');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to join the meeting.');
    }
  };

  const decideAdmission = async (participantId: string, admit: boolean) => {
    await trpc.meetings.decideAdmission.mutate({ meetingCode, participantId, admit });
    setJoinRequests((requests) => requests.filter((request) => request.id !== participantId));
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
  if (!meeting.inMeeting) {
    return (
      <WaitingRoom
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
      />
    );
  }

  return (
    <div className="w-full h-screen bg-gradient-to-br from-[#070a18] via-[#11162a] to-[#1b1038] text-slate-800 flex flex-col justify-start overflow-hidden relative select-none font-sans">
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
                    <button onClick={() => void decideAdmission(request.id, false)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      <X className="h-4 w-4" /> Deny
                    </button>
                    <button onClick={() => void decideAdmission(request.id, true)} className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
                      <Check className="h-4 w-4" /> Admit
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

      {/* TOP BAR */}
      <TopBar
        meetingTitle={meeting.meetingTitle}
        meetingCode={meeting.meetingCode}
        durationSeconds={meeting.durationSeconds}
        isRecording={meeting.isRecording}
        recordingMs={meeting.recordingMs}
        onOpenInfo={() => meeting.setIsInfoOpen(true)}
        onOpenLeave={() => meeting.setIsLeaveModalOpen(true)}
        layoutMode={meeting.layoutMode}
        onChangeLayout={meeting.setLayoutMode}
        inviteLink={meeting.meetingInfo.inviteLink}
      />

      {/* MAIN CONTENT AREA: Left Panel + Video Stage + Right Sidebar */}
      <div className="flex-1 min-h-0 w-full flex items-stretch overflow-hidden relative p-3 sm:p-4 gap-3 sm:gap-4">
        {/* LEFT PANEL */}
        <LeftPanel
          isWhiteboardOpen={meeting.isWhiteboardOpen}
          onToggleWhiteboard={() => meeting.setIsWhiteboardOpen((prev) => !prev)}
          isBgPickerOpen={isBgPickerOpen}
          onToggleBgPicker={() => setIsBgPickerOpen((prev) => !prev)}
          activeSidebarTab={meeting.activeSidebarTab}
          onToggleSidebarTab={meeting.toggleSidebarTab}
          isRecording={meeting.isRecording}
          onToggleRecording={meeting.toggleRecording}
          onOpenSettings={() => meeting.setIsSettingsOpen(true)}
          participantsCount={meeting.participants.length}
        />

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
          />

          {/* BOTTOM TOOLBAR CONTROLS (Below Video Grid in center column) */}
          <BottomControls
            isMicOn={meeting.isMicOn}
            onToggleMic={meeting.toggleMic}
            isCameraOn={meeting.isCameraOn}
            onToggleCamera={meeting.toggleCamera}
            isScreenSharing={meeting.isScreenSharing}
            onToggleScreenSharing={() => {
              if (meeting.isScreenSharing) {
                meeting.stopScreenSharing();
              } else {
                setIsScreenShareModalOpen(true);
              }
            }}
            isHandRaised={meeting.isHandRaised}
            onToggleHandRaised={meeting.toggleHandRaised}
            onOpenLeave={() => meeting.setIsLeaveModalOpen(true)}
          />

          {/* Collaborative Whiteboard Canvas Overlay */}
          {(meeting.isWhiteboardOpen || sharedWhiteboard.shared) && (
            <Whiteboard
              onClose={() => meeting.setIsWhiteboardOpen(false)}
              shared={sharedWhiteboard.shared}
              connected={sharedWhiteboard.connected}
              connectionError={sharedWhiteboard.connectionError}
              isHost={sharedWhiteboard.isHost}
              canEdit={sharedWhiteboard.connected ? sharedWhiteboard.canEdit : true}
              participants={sharedWhiteboard.participants}
              remoteSnapshot={sharedWhiteboard.snapshot}
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
                messages={meeting.messages}
                onSendMessage={meeting.sendMessage}
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
      {meeting.isInfoOpen && (
        <MeetingInfo info={meeting.meetingInfo} onClose={() => meeting.setIsInfoOpen(false)} />
      )}

      {meeting.isSettingsOpen && (
        <SettingsPanel
          deviceSettings={meeting.deviceSettings}
          setDeviceSettings={meeting.setDeviceSettings}
          onClose={() => meeting.setIsSettingsOpen(false)}
        />
      )}

      {isBgPickerOpen && (
        <BackgroundPickerModal
          activeBg={meeting.deviceSettings.backgroundBlur}
          onSelectBg={(bg) =>
            meeting.setDeviceSettings((prev) => ({ ...prev, backgroundBlur: bg }))
          }
          onClose={() => setIsBgPickerOpen(false)}
        />
      )}

      {isScreenShareModalOpen && (
        <ScreenShareModal
          onStartShare={(item) => {
            meeting.startScreenSharing(item.title);
            setIsScreenShareModalOpen(false);
          }}
          onClose={() => setIsScreenShareModalOpen(false)}
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
