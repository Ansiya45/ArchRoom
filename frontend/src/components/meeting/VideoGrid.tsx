'use client';

import React from 'react';
import { Participant, LayoutMode, BackgroundChoice } from '@/types/meeting';
import { VideoCard } from './VideoCard';

interface VideoGridProps {
  participants: Participant[];
  activeSpeakerId: string;
  pinnedParticipantId: string | null;
  layoutMode: LayoutMode;
  activeBg?: BackgroundChoice;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onSelectSpeaker: (id: string) => void;
  localStream?: MediaStream | null;
  remoteStreams?: Record<string, MediaStream>;
  remoteBackgrounds?: Record<string, BackgroundChoice>;
  remoteScreenShares?: Record<string, boolean>;
  localDisplayStream?: MediaStream | null;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  participants,
  activeSpeakerId,
  pinnedParticipantId,
  layoutMode,
  activeBg = 'none',
  onTogglePin,
  onToggleMute,
  onSelectSpeaker,
  localStream,
  remoteStreams = {},
  remoteBackgrounds = {},
  remoteScreenShares = {},
  localDisplayStream,
}) => {
  const participantBackground = (participantId: string) =>
    participantId === 'user-self' ? activeBg : remoteBackgrounds[participantId] || 'none';
  // Determine active main speaker
  const mainParticipant =
    participants.find((p) => p.id === pinnedParticipantId) ||
    participants.find((p) => p.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[p.id])) ||
    participants.find((p) => p.id === activeSpeakerId) ||
    participants.find((p) => p.isScreenSharing) ||
    participants[0];

  // Remaining participants for secondary side column/grid
  const stripParticipants = participants.filter((p) => p.id !== mainParticipant?.id);

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col justify-between p-1 sm:p-2 md:p-3 overflow-hidden relative">
      {layoutMode === 'speaker' ? (
        /* SPEAKER VIEW: Main Speaker on Left + Secondary Callers on Right (matching reference image) */
        <div className="w-full h-full flex flex-col md:flex-row gap-3 sm:gap-4 min-h-0 overflow-hidden">
          {/* Main Hero Speaker Box */}
          <div
            className={`h-full min-h-0 relative rounded-3xl overflow-hidden shadow-xl transition-all duration-300 ${
              stripParticipants.length > 0 ? 'w-full md:w-[60%] lg:w-[65%]' : 'w-full'
            }`}
          >
            {mainParticipant ? (
              <VideoCard
                participant={{
                  ...mainParticipant,
                  isPinned: mainParticipant.id === pinnedParticipantId,
                  isScreenSharing: mainParticipant.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[mainParticipant.id]),
                }}
                isMainStage={true}
                activeBg={participantBackground(mainParticipant.id)}
                onTogglePin={onTogglePin}
                onToggleMute={onToggleMute}
                isSelf={mainParticipant.id === 'user-self'}
                mediaStream={mainParticipant.id === 'user-self' ? (localDisplayStream || localStream) : remoteStreams[mainParticipant.id]}
              />
            ) : (
              <div className="w-full h-full bg-white/60 border border-white rounded-3xl flex items-center justify-center text-slate-500 backdrop-blur-xl shadow-xl">
                <span>No active speaker</span>
              </div>
            )}
          </div>

          {/* Secondary Callers Area (right side in desktop mode, bottom on mobile) */}
          {stripParticipants.length > 0 && (
            <div className="w-full md:w-[40%] lg:w-[35%] h-52 md:h-full flex-shrink-0 min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              <div
                className={`grid gap-3 w-full h-full min-h-full ${
                  stripParticipants.length === 1
                    ? 'grid-cols-1 grid-rows-1'
                    : stripParticipants.length === 2
                    ? 'grid-cols-2 md:grid-cols-1 md:grid-rows-2'
                    : stripParticipants.length <= 4
                    ? 'grid-cols-2 md:grid-cols-1 md:grid-rows-2'
                    : 'grid-cols-2 md:grid-cols-2'
                }`}
              >
                {stripParticipants.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => onSelectSpeaker(p.id)}
                    className="w-full h-full min-h-[120px] md:min-h-0 cursor-pointer transition-transform hover:scale-[1.01] active:scale-95 rounded-2xl overflow-hidden shadow-md"
                  >
                    <VideoCard
                      participant={{
                        ...p,
                        isPinned: p.id === pinnedParticipantId,
                        isScreenSharing: p.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[p.id]),
                      }}
                      isMainStage={false}
                      activeBg={participantBackground(p.id)}
                      onTogglePin={onTogglePin}
                      onToggleMute={onToggleMute}
                      isSelf={p.id === 'user-self'}
                      mediaStream={p.id === 'user-self' ? (localDisplayStream || localStream) : remoteStreams[p.id]}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* GRID VIEW: Responsive Equal Tile Layout */
        <div className="w-full h-full min-h-0 overflow-y-auto pr-1 scrollbar-thin">
          <div
            className={`grid gap-3 sm:gap-4 w-full h-full min-h-full ${
              participants.length === 1
                ? 'grid-cols-1'
                : participants.length <= 2
                ? 'grid-cols-1 md:grid-cols-2'
                : participants.length <= 4
                ? 'grid-cols-1 sm:grid-cols-2'
                : participants.length <= 6
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
            }`}
          >
            {participants.map((p) => (
              <div key={p.id} className="min-h-[180px] sm:min-h-[220px] w-full h-full">
                <VideoCard
                  participant={{
                    ...p,
                    isPinned: p.id === pinnedParticipantId,
                    isScreenSharing: p.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[p.id]),
                  }}
                  isMainStage={false}
                  activeBg={participantBackground(p.id)}
                  onTogglePin={onTogglePin}
                  onToggleMute={onToggleMute}
                  isSelf={p.id === 'user-self'}
                  mediaStream={p.id === 'user-self' ? (localDisplayStream || localStream) : remoteStreams[p.id]}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
