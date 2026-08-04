'use client';

import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Hand,
  PhoneOff,
} from 'lucide-react';

interface BottomControlsProps {
  isMicOn: boolean;
  onToggleMic: () => void;
  isCameraOn: boolean;
  onToggleCamera: () => void;
  isScreenSharing: boolean;
  onToggleScreenSharing: () => void;
  isHandRaised: boolean;
  onToggleHandRaised: () => void;
  onOpenLeave: () => void;
}

interface ControlButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  isDanger?: boolean;
  tooltip: string;
}

const ControlButton: React.FC<ControlButtonProps> = ({
  onClick,
  icon,
  label,
  isActive = false,
  isDanger = false,
  tooltip,
}) => {
  return (
    <div className="relative group flex flex-col items-center">
      {/* Tooltip */}
      <div className="absolute -top-11 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:-translate-y-1">
        <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 border border-white/20 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl backdrop-blur-md">
          {tooltip}
        </div>
      </div>

      {/* Button */}
      <button
        onClick={onClick}
        className={`relative flex items-center justify-center space-x-1 p-3 sm:p-3.5 rounded-xl transition-all duration-200 backdrop-blur-md border ${
          isDanger
            ? 'bg-red-500 hover:bg-red-600 text-white border-red-400 shadow-md shadow-red-200 active:scale-95'
            : isActive
            ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500 shadow-lg shadow-blue-200 active:scale-95'
            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 shadow-sm active:scale-95'
        }`}
      >
        <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
      </button>

      {/* Control Label below icon */}
      <span className="text-[10px] font-semibold text-slate-600 mt-1 hidden md:block">
        {label}
      </span>
    </div>
  );
};

export const BottomControls: React.FC<BottomControlsProps> = ({
  isMicOn,
  onToggleMic,
  isCameraOn,
  onToggleCamera,
  isScreenSharing,
  onToggleScreenSharing,
  isHandRaised,
  onToggleHandRaised,
  onOpenLeave,
}) => {
  return (
    <footer className="w-full flex-shrink-0 pt-2 pb-1 px-2 sm:px-4 flex items-center justify-center z-20 transition-all duration-300">
      <div className="flex items-center space-x-2 sm:space-x-4 backdrop-blur-2xl bg-white/80 px-4 sm:px-6 py-2 rounded-2xl border border-white shadow-xl shadow-blue-900/5">
        {/* 1. Audio (Mic) */}
        <ControlButton
          onClick={onToggleMic}
          icon={isMicOn ? <Mic /> : <MicOff />}
          label={isMicOn ? 'Audio On' : 'Audio Off'}
          isActive={isMicOn}
          isDanger={!isMicOn}
          tooltip={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
        />

        {/* 2. Video (Camera) */}
        <ControlButton
          onClick={onToggleCamera}
          icon={isCameraOn ? <Video /> : <VideoOff />}
          label={isCameraOn ? 'Video On' : 'Video Off'}
          isActive={isCameraOn}
          isDanger={!isCameraOn}
          tooltip={isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
        />

        <div className="h-8 w-px bg-slate-200/80 mx-1 hidden sm:block" />

        {/* 3. Share Screen */}
        <ControlButton
          onClick={onToggleScreenSharing}
          icon={<Monitor />}
          label={isScreenSharing ? 'Stop Share' : 'Share Screen'}
          isActive={isScreenSharing}
          tooltip={isScreenSharing ? 'Stop Screen Sharing' : 'Share Entire Screen'}
        />

        {/* 4. Raise Hand */}
        <ControlButton
          onClick={onToggleHandRaised}
          icon={<Hand />}
          label="Raise Hand"
          isActive={isHandRaised}
          tooltip={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
        />

        <div className="h-8 w-px bg-slate-200/80 mx-1 hidden sm:block" />

        {/* 5. Leave Button */}
        <ControlButton
          onClick={onOpenLeave}
          icon={<PhoneOff />}
          label="Leave"
          isDanger={true}
          tooltip="Leave Meeting"
        />
      </div>
    </footer>
  );
};
