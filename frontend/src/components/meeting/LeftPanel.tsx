'use client';

import React from 'react';
import {
  PenTool,
  Palette,
  MessageSquare,
  Users,
  Disc,
  Settings,
} from 'lucide-react';
import { SidebarTab } from '@/types/meeting';

interface LeftPanelProps {
  isWhiteboardOpen: boolean;
  onToggleWhiteboard: () => void;
  isBgPickerOpen?: boolean;
  onToggleBgPicker?: () => void;
  activeSidebarTab: SidebarTab;
  onToggleSidebarTab: (tab: SidebarTab) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  onOpenSettings: () => void;
  participantsCount?: number;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({
  isWhiteboardOpen,
  onToggleWhiteboard,
  isBgPickerOpen = false,
  onToggleBgPicker,
  activeSidebarTab,
  onToggleSidebarTab,
  isRecording,
  onToggleRecording,
  onOpenSettings,
  participantsCount,
}) => {
  return (
    <aside className="w-16 sm:w-20 h-full flex flex-col justify-between items-center py-4 bg-white/70 backdrop-blur-xl border border-white/80 rounded-3xl shadow-xl z-30 shrink-0">
      {/* Top / Main Navigation Group */}
      <div className="flex flex-col items-center space-y-3 sm:space-y-4 w-full">
        {/* 1. Whiteboard */}
        <div className="relative group flex items-center justify-center">
          <button
            onClick={onToggleWhiteboard}
            className={`p-3 rounded-2xl transition-all duration-200 border ${
              isWhiteboardOpen
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-200 scale-105'
                : 'bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border-slate-200/60 hover:scale-105'
            }`}
          >
            <PenTool className="w-5 h-5" />
          </button>
          <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
              Whiteboard
            </div>
          </div>
        </div>

        {/* 2. Change Background */}
        <div className="relative group flex items-center justify-center">
          <button
            onClick={onToggleBgPicker}
            className={`p-3 rounded-2xl transition-all duration-200 border ${
              isBgPickerOpen
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-200 scale-105'
                : 'bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border-slate-200/60 hover:scale-105'
            }`}
          >
            <Palette className="w-5 h-5" />
          </button>
          <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
              Change Background
            </div>
          </div>
        </div>

        {/* 3. Chat */}
        <div className="relative group flex items-center justify-center">
          <button
            onClick={() => onToggleSidebarTab('chat')}
            className={`p-3 rounded-2xl transition-all duration-200 border ${
              activeSidebarTab === 'chat'
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-200 scale-105'
                : 'bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border-slate-200/60 hover:scale-105'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
              Chat
            </div>
          </div>
        </div>

        {/* 4. People */}
        <div className="relative group flex items-center justify-center">
          <button
            onClick={() => onToggleSidebarTab('participants')}
            className={`p-3 rounded-2xl transition-all duration-200 border relative ${
              activeSidebarTab === 'participants'
                ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-200 scale-105'
                : 'bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border-slate-200/60 hover:scale-105'
            }`}
          >
            <Users className="w-5 h-5" />
            {participantsCount !== undefined && participantsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-white">
                {participantsCount}
              </span>
            )}
          </button>
          <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
              People
            </div>
          </div>
        </div>

        {/* 5. Record */}
        <div className="relative group flex items-center justify-center">
          <button
            onClick={onToggleRecording}
            className={`p-3 rounded-2xl transition-all duration-200 border ${
              isRecording
                ? 'bg-red-500 text-white border-red-400 shadow-md shadow-red-200 animate-pulse scale-105'
                : 'bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border-slate-200/60 hover:scale-105'
            }`}
          >
            <Disc className={`w-5 h-5 ${isRecording ? 'animate-spin' : ''}`} />
          </button>
          <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
            <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
              Record
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Group: 6. Settings at the end */}
      <div className="relative group flex items-center justify-center w-full pt-2">
        <button
          onClick={onOpenSettings}
          className="p-3 rounded-2xl bg-slate-100/80 hover:bg-slate-200/80 text-slate-600 border border-slate-200/60 hover:scale-105 transition-all duration-200"
        >
          <Settings className="w-5 h-5" />
        </button>
        <div className="absolute left-20 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 transform group-hover:translate-x-1">
          <div className="px-2.5 py-1 rounded-lg bg-slate-900/90 text-white text-[11px] font-semibold whitespace-nowrap shadow-xl">
            Settings
          </div>
        </div>
      </div>
    </aside>
  );
};
