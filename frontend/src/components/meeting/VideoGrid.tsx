'use client';

import React from 'react';
import { Participant, LayoutMode, BackgroundChoice } from '@/types/meeting';
import { VideoCard } from './VideoCard';

const SharedPresentation: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => undefined);
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="h-full w-full bg-black object-contain" />;
};

interface VideoGridProps {
  participants: Participant[];
  activeSpeakerId: string;
  pinnedParticipantId: string | null;
  layoutMode: LayoutMode;
  activeBg?: BackgroundChoice;
  onTogglePin: (id: string) => void;
  onToggleMute?: (id: string) => void;
  onSelectSpeaker: (id: string) => void;
  localStream?: MediaStream | null;
  remoteStreams?: Record<string, MediaStream>;
  remoteBackgrounds?: Record<string, BackgroundChoice>;
  remoteScreenShares?: Record<string, boolean>;
  remoteScreenStreams?: Record<string, MediaStream>;
  localDisplayStream?: MediaStream | null;
  remoteRaisedHands?: Record<string, boolean>;
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
  remoteScreenStreams = {},
  localDisplayStream,
  remoteRaisedHands = {},
}) => {
  const secondaryGridClass = (count: number) => count === 1
    ? 'grid-cols-1 place-items-center'
    : count === 2
      ? 'grid-cols-1 grid-rows-2 place-items-center'
      : count === 3
        ? 'grid-cols-2 grid-rows-[minmax(0,2fr)_minmax(0,1fr)] place-items-center'
        : count === 4
          ? 'grid-cols-2 grid-rows-2 place-items-center'
          : 'grid-cols-2 auto-rows-max';
  const secondaryTileClass = (count: number, index: number) => {
    if (count === 3 && index === 0) return 'col-span-2';
    return '';
  };
  const secondaryTileStyle = (count: number, index: number): React.CSSProperties => {
    const gap = 'var(--secondary-gap)';
    const size = count === 1
      ? 'min(100cqw, 100cqh)'
      : count === 2
        ? '100%'
        : count === 3 && index === 0
          ? `min(100cqw, calc((100cqh - ${gap}) * 2 / 3))`
          : count === 3
            ? `min(calc((100cqw - ${gap}) / 2), calc((100cqh - ${gap}) / 3))`
            : count === 4
              ? `min(calc((100cqw - ${gap}) / 2), calc((100cqh - ${gap}) / 2))`
              : `calc((100cqw - ${gap}) / 2)`;
    return count === 2 ? { width: size, height: `calc((100cqh - ${gap}) / 2)` } : { width: size, height: size };
  };
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
  const presenter = participants.find(p => p.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[p.id]));

  if (presenter) {
    const screenStream = presenter.id === 'user-self' ? localDisplayStream : remoteScreenStreams[presenter.id];
    const count = participants.length;
    const presentationParticipants = pinnedParticipantId
      ? [...participants].sort((a, b) => Number(b.id === pinnedParticipantId) - Number(a.id === pinnedParticipantId))
      : participants;
    return <div data-testid="presentation-layout" className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden md:flex-row md:gap-3">
      <div data-testid="presentation-screen" className="relative min-h-0 min-w-0 flex-[2] overflow-hidden rounded-2xl bg-black md:h-full">
        {screenStream ? <SharedPresentation stream={screenStream} /> : <div className="flex h-full min-h-32 items-center justify-center text-sm text-white">{presenter.name} is sharing</div>}
        <span className="absolute left-3 top-3 z-10 rounded-lg bg-black/60 px-3 py-1 text-xs text-white">{presenter.name} is presenting</span>
      </div>
      <div data-testid="presentation-participants" style={{ containerType: 'size', '--secondary-gap': '0.5rem' } as React.CSSProperties} className={`min-h-0 min-w-0 shrink-0 overflow-y-auto overscroll-contain md:h-full md:w-[34%] ${count <= 3 ? 'h-28' : 'h-40'}`}>
        <div className={`grid h-full min-h-0 gap-2 ${secondaryGridClass(count)}`}>
          {presentationParticipants.map((p, index) => <div key={p.id} data-testid="presentation-tile" data-participant-id={p.id} style={secondaryTileStyle(count, index)} className={`${secondaryTileClass(count, index)} min-h-0 min-w-0 overflow-hidden rounded-xl`}>
            <VideoCard participant={{ ...p, isPinned: p.id === pinnedParticipantId, isScreenSharing: false,
              isHandRaised: p.id === 'user-self' ? p.isHandRaised : Boolean(remoteRaisedHands[p.id]) }}
              isMainStage={false} activeBg={participantBackground(p.id)} onTogglePin={onTogglePin} onToggleMute={onToggleMute}
              isSelf={p.id === 'user-self'} mediaStream={p.id === 'user-self' ? localStream : remoteStreams[p.id]} />
          </div>)}
        </div>
      </div>
    </div>;
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col justify-between px-1 sm:px-2 md:px-3 overflow-hidden relative">
      {layoutMode === 'speaker' ? (
        /* SPEAKER VIEW: Main Speaker on Left + Secondary Callers on Right (matching reference image) */
        <div className="w-full h-full flex flex-col md:flex-row gap-3 sm:gap-4 min-h-0 overflow-hidden">
          {/* Main Hero Speaker Box */}
          <div
            data-testid="speaker-main"
            data-participant-id={mainParticipant?.id}
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
                  isHandRaised: mainParticipant.id === 'user-self' ? mainParticipant.isHandRaised : Boolean(remoteRaisedHands[mainParticipant.id]),
                }}
                isMainStage={true}
                activeBg={participantBackground(mainParticipant.id)}
                onTogglePin={onTogglePin}
                onToggleMute={onToggleMute}
                isSelf={mainParticipant.id === 'user-self'}
                mediaStream={mainParticipant.id === 'user-self' ? localStream : remoteStreams[mainParticipant.id]}
              />
            ) : (
              <div className="w-full h-full bg-white/60 border border-white rounded-3xl flex items-center justify-center text-slate-500 backdrop-blur-xl shadow-xl">
                <span>No active speaker</span>
              </div>
            )}
          </div>

          {/* Secondary Callers Area (right side in desktop mode, bottom on mobile) */}
          {stripParticipants.length > 0 && (
            <div style={{ containerType: 'size', '--secondary-gap': '0.75rem' } as React.CSSProperties} className="w-full md:w-[40%] lg:w-[35%] h-52 md:h-full flex-shrink-0 min-h-0 overflow-y-auto pr-0.5 scrollbar-thin">
              <div className={`grid gap-3 w-full h-full min-h-full ${secondaryGridClass(stripParticipants.length)}`}>
                {stripParticipants.map((p, index) => (
                  <div
                    key={p.id}
                    data-testid="speaker-secondary-tile"
                    data-participant-id={p.id}
                    onClick={() => onSelectSpeaker(p.id)}
                    style={secondaryTileStyle(stripParticipants.length, index)}
                    className={`${secondaryTileClass(stripParticipants.length, index)} min-h-0 min-w-0 cursor-pointer transition-transform hover:scale-[1.01] active:scale-95 rounded-2xl overflow-hidden shadow-md`}
                  >
                    <VideoCard
                      participant={{
                        ...p,
                        isPinned: p.id === pinnedParticipantId,
                        isScreenSharing: p.id === 'user-self' ? Boolean(localDisplayStream) : Boolean(remoteScreenShares[p.id]),
                        isHandRaised: p.id === 'user-self' ? p.isHandRaised : Boolean(remoteRaisedHands[p.id]),
                      }}
                      isMainStage={false}
                      activeBg={participantBackground(p.id)}
                      onTogglePin={onTogglePin}
                      onToggleMute={onToggleMute}
                      isSelf={p.id === 'user-self'}
                      mediaStream={p.id === 'user-self' ? localStream : remoteStreams[p.id]}
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
                    isHandRaised: p.id === 'user-self' ? p.isHandRaised : Boolean(remoteRaisedHands[p.id]),
                  }}
                  isMainStage={false}
                  activeBg={participantBackground(p.id)}
                  onTogglePin={onTogglePin}
                  onToggleMute={onToggleMute}
                  isSelf={p.id === 'user-self'}
                  mediaStream={p.id === 'user-self' ? localStream : remoteStreams[p.id]}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
