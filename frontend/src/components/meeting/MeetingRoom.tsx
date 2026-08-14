'use client';

import React, { useState } from 'react';
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
import {
  PenTool,
  X,
  Sparkles,
  PhoneOff,
  HelpCircle,
  FileQuestion,
  BarChart3,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { getMeetingSession, storeMeetingSession } from '@/lib/meetingSession';

interface MeetingRoomProps {
  meetingCode?: string;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  meetingCode = 'arch-9284-xkp',
}) => {
  const meeting = useMeeting(meetingCode);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState<boolean>(false);
  const [isScreenShareModalOpen, setIsScreenShareModalOpen] = useState<boolean>(false);

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
      } else {
        const joined = await trpc.meetings.join.mutate({
          meetingCode: meeting.meetingCode,
          guestName: displayName,
        });
        storeMeetingSession(meeting.meetingCode, {
          displayName,
          participantId: joined.participant.id,
        });
      }

      meeting.joinMeeting();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to join the meeting.');
    }
  };

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
          {meeting.isWhiteboardOpen && (
            <div className="absolute inset-2 sm:inset-4 z-40 bg-white/90 backdrop-blur-2xl border border-blue-100 rounded-3xl p-6 shadow-2xl flex flex-col space-y-4 animate-fadeIn text-slate-800">
              <div className="flex items-center justify-between border-b border-blue-100 pb-4">
                <div className="flex items-center space-x-2 text-blue-600 font-bold text-base">
                  <PenTool className="w-5 h-5" />
                  <span>ArchRoom Interactive Blueprint Canvas</span>
                </div>
                <button
                  onClick={() => meeting.setIsWhiteboardOpen(false)}
                  className="p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Whiteboard Canvas Visual Mock */}
              <div className="flex-1 rounded-2xl bg-slate-900 border border-blue-200 p-6 flex items-center justify-center relative overflow-hidden group shadow-inner">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-40" />
                <div className="relative z-10 text-center space-y-3">
                  <div className="p-4 rounded-2xl bg-blue-500/20 text-blue-400 w-16 h-16 mx-auto flex items-center justify-center border border-blue-500/40 shadow-lg">
                    <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '10s' }} />
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    Real-time Architectural Drawing Canvas Active
                  </h3>
                  <p className="text-xs text-slate-300 max-w-md">
                    All participants can draw, add sticky notes, drop CAD markers, and annotate live.
                  </p>
                </div>
              </div>
            </div>
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
              <h3 className="text-xl font-bold">Leave ArchRoom Meeting?</h3>
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
                onClick={meeting.leaveMeeting}
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
