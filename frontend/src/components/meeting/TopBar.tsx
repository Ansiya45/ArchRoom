'use client';

import React from 'react';
import {
  Video,
  UserPlus,
  Grid,
  Maximize2,
} from 'lucide-react';
import { LayoutMode } from '@/types/meeting';

interface TopBarProps {
  meetingTitle?: string;
  meetingCode?: string;
  durationSeconds?: number;
  isRecording?: boolean;
  recordingMs?: number;
  onOpenInfo: () => void;
  onOpenLeave?: () => void;
  layoutMode: LayoutMode;
  onChangeLayout: (mode: LayoutMode) => void;
  inviteLink?: string;
}

const formatRecordingTime = (ms: number = 0) => {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor((ms % 1000) / 10);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(milliseconds)}`;
};

export const TopBar: React.FC<TopBarProps> = ({
  isRecording = false,
  recordingMs = 0,
  onOpenInfo,
  layoutMode,
  onChangeLayout,
}) => {
  return (
    <header className="w-full h-16 flex-shrink-0 px-4 md:px-6 backdrop-blur-xl bg-white/60 border-b border-blue-100/50 shadow-sm flex items-center justify-between text-slate-800 select-none z-50">
      {/* Left: Video Icon & YLAAM-MEET */}
      <div className="flex items-center space-x-3 cursor-pointer group" onClick={onOpenInfo}>
        <div className="relative w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200 group-hover:scale-105 transition-transform duration-300">
          <Video className="w-5 h-5 text-white" />
          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-400 rounded-full animate-ping" />
        </div>
        <span className="font-bold tracking-tight text-lg text-slate-900">
          YLAAM-MEET
        </span>
      </div>

      {/* Center: Red Recording Timer Badge */}
      {isRecording && (
        <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 shadow-sm animate-fadeIn">
          <div className="relative flex items-center justify-center w-3 h-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 hidden sm:inline">
            REC
          </span>
          <span className="font-mono text-xs sm:text-sm font-extrabold text-rose-600 tracking-wider">
            {formatRecordingTime(recordingMs)}
          </span>
        </div>
      )}

      {/* Right: Layout Switcher & Invite Button */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Layout Mode Toggle (Fullscreen / Speaker & Grid) */}
        <div className="flex p-1 bg-white/80 rounded-xl border border-blue-100 shadow-sm">
          <button
            onClick={() => onChangeLayout('speaker')}
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              layoutMode === 'speaker'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80'
            }`}
            title="Full Screen / Speaker View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onChangeLayout('grid')}
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              layoutMode === 'grid'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80'
            }`}
            title="Grid View"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>

        {/* Invite Button */}
        <button
          onClick={onOpenInfo}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-blue-200 transition-all duration-200 active:scale-95 flex items-center space-x-1.5"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite</span>
        </button>
      </div>
    </header>
  );
};

