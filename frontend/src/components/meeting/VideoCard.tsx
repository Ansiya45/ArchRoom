'use client';

import React from 'react';
import {
  Mic,
  MicOff,
  Pin,
  Hand,
  MoreVertical,
  Volume2,
  Share2,
  Sparkles,
  Wifi,
  ShieldAlert,
} from 'lucide-react';
import { Participant, BackgroundChoice } from '@/types/meeting';
import { CameraVideo } from './CameraVideo';

interface VideoCardProps {
  participant: Participant;
  isMainStage?: boolean;
  onTogglePin?: (id: string) => void;
  onToggleMute?: (id: string) => void;
  isSelf?: boolean;
  activeBg?: BackgroundChoice;
  mediaStream?: MediaStream | null;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  participant,
  isMainStage = false,
  onTogglePin,
  onToggleMute,
  isSelf = false,
  activeBg = 'none',
  mediaStream,
}) => {
  const {
    id,
    name,
    avatar,
    designation,
    role,
    isMuted,
    isCameraOn,
    isSpeaking,
    isHandRaised,
    isPinned,
    isScreenSharing,
    audioLevel,
  } = participant;

  return (
    <div
      className={`relative group rounded-3xl overflow-hidden backdrop-blur-xl transition-all duration-300 border ${
        isSpeaking
          ? 'border-blue-500 shadow-2xl shadow-blue-500/25 ring-2 ring-blue-400/60'
          : 'border-white/80 bg-white/40 shadow-xl hover:border-white'
      } ${isMainStage ? 'w-full h-full min-h-[380px]' : 'w-full h-full min-h-[160px]'}`}
    >
      {/* Screen Share / Active Video Canvas Mock */}
      {isScreenSharing ? (
        <div className="absolute inset-0 bg-slate-950 flex flex-col justify-between p-4 overflow-hidden">
          {/* Mock Blueprint / Code Slide Screen */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950/40 to-slate-950 opacity-90" />
          
          {/* Blueprint Grid graphic background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:32px_32px] opacity-40" />

          {/* Screen Share Header overlay */}
          <div className="relative z-10 flex items-center justify-between px-4 py-2 rounded-2xl bg-black/40 backdrop-blur-md border border-white/20">
            <div className="flex items-center space-x-2 text-blue-300 font-semibold text-xs sm:text-sm">
              <Share2 className="w-4 h-4 animate-bounce" />
              <span>
                {name} is sharing — {participant.sharedScreenTitle || 'YLAAM-MEET BIM Studio v4'}
              </span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-lg bg-blue-500/30 text-blue-200 border border-blue-400/40 font-mono">
              Live Stream (60fps)
            </span>
          </div>

          {/* Interactive Blueprint Mock Content */}
          <div className="relative z-10 my-auto flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-full max-w-2xl bg-slate-900/90 rounded-2xl border border-blue-500/30 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                </div>
                <span className="text-xs font-mono text-slate-400">
                  Project_Facade_Structure_3D.cad
                </span>
              </div>
              <div className="h-44 sm:h-56 bg-slate-950/80 rounded-xl border border-white/5 flex items-center justify-center relative overflow-hidden group/canvas">
                <div className="absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] opacity-20" />
                <div className="text-center space-y-2 z-10">
                  <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center mx-auto text-blue-400">
                    <Sparkles className="w-8 h-8 animate-spin" style={{ animationDuration: '8s' }} />
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-slate-200">
                    Interactive 3D Cantilever & Facade Blueprint
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Zoom: 140% • Stress Load: Safe • Thermal Glazing Class A
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : isCameraOn || Boolean(mediaStream?.getVideoTracks().length) ? (
        /* Camera Video View */
        <div className="absolute inset-0 bg-slate-900 overflow-hidden">
          <CameraVideo
            isCameraOn={isCameraOn || Boolean(mediaStream?.getVideoTracks().length)}
            activeBg={activeBg}
            fallbackAvatar={avatar}
            isSelf={isSelf || id === 'user-self'}
            mediaStream={mediaStream}
          />
          {/* Subtle gradient vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none z-10" />
        </div>
      ) : (
        /* Camera Off Google Account Profile Avatar View */
        <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-4">
          <div className="relative flex flex-col items-center">
            <div
              className={`relative rounded-full overflow-hidden border-2 transition-all duration-300 shadow-2xl ${
                isMainStage
                  ? 'w-24 h-24 sm:w-32 sm:h-32 md:w-36 md:h-36'
                  : 'w-16 h-16 sm:w-20 sm:h-20'
              } ${
                isSpeaking
                  ? 'border-blue-400 ring-4 ring-blue-500/40 scale-105'
                  : 'border-white/30'
              }`}
            >
              <img
                src={avatar}
                alt={name}
                className="w-full h-full object-cover rounded-full"
              />
            </div>

            <p className="mt-3 font-semibold text-white text-sm sm:text-base text-center truncate max-w-[220px]">
              {name}
            </p>
            {designation && (
              <span className="text-xs text-slate-400 truncate max-w-[200px] text-center">
                {designation}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Top Left Badges: Role & Hand Raised Emoji */}
      <div className="absolute top-3 left-3 z-20 flex items-center space-x-2">
        {role === 'host' && (
          <span className="px-2.5 py-1 rounded-xl bg-blue-600/90 backdrop-blur-md text-white text-[10px] font-bold border border-blue-400/50 shadow-md">
            HOST
          </span>
        )}
        {role === 'co-host' && (
          <span className="px-2.5 py-1 rounded-xl bg-indigo-600/90 backdrop-blur-md text-white text-[10px] font-semibold border border-indigo-400/50 shadow-md">
            CO-HOST
          </span>
        )}

        {/* Hand Raised Emoji Badge Only (No text) */}
        {isHandRaised && (
          <div className="flex items-center justify-center p-2 rounded-full bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/40 animate-bounce">
            <Hand className="w-4 h-4 fill-current" />
          </div>
        )}
      </div>

      {/* Top Right Quick Actions */}
      <div className={`absolute top-3 right-3 z-20 flex items-center space-x-1.5 transition-opacity duration-200 ${
        isPinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {onTogglePin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(id);
            }}
            className={`p-2 rounded-xl backdrop-blur-md border transition-all ${
              isPinned
                ? 'bg-blue-600 text-white border-blue-400 shadow-lg'
                : 'bg-black/40 text-white border-white/20 hover:bg-black/60'
            }`}
            title={isPinned ? 'Unpin Speaker' : 'Pin Speaker'}
          >
            <Pin className="w-3.5 h-3.5 fill-current" />
          </button>
        )}

        {onToggleMute && !isSelf && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute(id);
            }}
            className={`p-2 rounded-xl backdrop-blur-md border transition-all ${
              isMuted
                ? 'bg-red-500/80 text-white border-red-400'
                : 'bg-black/40 text-white border-white/20 hover:bg-black/60'
            }`}
            title={isMuted ? 'Unmute Participant' : 'Mute Participant'}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Bottom Overlay: Participant Info & Live Equalizer Wave */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
        {/* Name Pill */}
        <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-black/40 backdrop-blur-md border border-white/20 text-white max-w-[85%] shadow-lg">
          {/* Mute/Mic status */}
          <div
            className={`p-1 rounded-md ${
              isMuted ? 'bg-red-500/30 text-red-300' : 'bg-emerald-500/30 text-emerald-300'
            }`}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </div>

          <span className="text-xs font-semibold truncate">
            {name}
          </span>

          {/* Equalizer animation when speaking */}
          {!isMuted && isSpeaking && (
            <div className="flex items-end space-x-0.5 h-3 px-1">
              <div
                className="w-0.5 bg-blue-400 rounded-full animate-bounce"
                style={{ height: `${Math.max(20, audioLevel)}%`, animationDuration: '0.4s' }}
              />
              <div
                className="w-0.5 bg-blue-400 rounded-full animate-bounce"
                style={{ height: `${Math.max(40, audioLevel * 0.8)}%`, animationDuration: '0.3s' }}
              />
              <div
                className="w-0.5 bg-blue-400 rounded-full animate-bounce"
                style={{ height: `${Math.max(15, audioLevel * 0.5)}%`, animationDuration: '0.5s' }}
              />
            </div>
          )}
        </div>

        {/* Pin indicator badge (Clickable to unpin) */}
        {isPinned && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin?.(id);
            }}
            className="pointer-events-auto px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold border border-blue-300/40 flex items-center space-x-1 shadow-md transition-colors"
            title="Click to unpin"
          >
            <Pin className="w-3 h-3 fill-current" />
            <span className="hidden sm:inline">Pinned</span>
          </button>
        )}
      </div>
    </div>
  );
};
