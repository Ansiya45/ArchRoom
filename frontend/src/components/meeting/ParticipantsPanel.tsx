'use client';

import React, { useState } from 'react';
import {
  Users,
  Search,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  Pin,
  MoreVertical,
  UserPlus,
  VolumeX,
  X,
  ShieldCheck,
} from 'lucide-react';
import { Participant } from '@/types/meeting';

interface ParticipantsPanelProps {
  participants: Participant[];
  onToggleMute: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClose: () => void;
  onOpenInfo: () => void;
}

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  participants,
  onToggleMute,
  onTogglePin,
  onClose,
  onOpenInfo,
}) => {
  const [search, setSearch] = useState('');

  const filteredParticipants = participants.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-white/75 backdrop-blur-2xl border border-white rounded-3xl shadow-xl text-slate-800 overflow-hidden">
      {/* Panel Header */}
      <div className="p-4 border-b border-blue-100/60 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <h2 className="font-bold text-base text-slate-900">Participants</h2>
          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-bold border border-blue-200/60">
            {participants.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Top Actions: Search & Invite */}
      <div className="p-4 space-y-3 border-b border-blue-100/60 bg-white/50 flex-shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search participants..."
            className="w-full py-2 pl-10 pr-4 rounded-xl bg-white border border-blue-100 text-slate-800 placeholder-slate-400 text-xs sm:text-sm focus:outline-none focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenInfo}
            className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center space-x-2 shadow-sm shadow-blue-200 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Invite People</span>
          </button>
          <button
            className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 border border-slate-200 transition-all"
            title="Mute All Attendees"
          >
            <VolumeX className="w-3.5 h-3.5 text-red-500" />
            <span>Mute All</span>
          </button>
        </div>
      </div>

      {/* Participants List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-slate-200">
        {filteredParticipants.map((p) => {
          const isSelf = p.id === 'user-self';
          return (
            <div
              key={p.id}
              className="p-2.5 rounded-2xl hover:bg-white/80 transition-all flex items-center justify-between group border border-transparent hover:border-blue-100/60"
            >
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="relative">
                  <img
                    src={p.avatar}
                    alt={p.name}
                    className="w-10 h-10 rounded-full object-cover border border-white shadow-sm"
                  />
                  {p.isSpeaking && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                  )}
                </div>

                <div className="overflow-hidden">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-xs sm:text-sm font-semibold text-slate-800 truncate">
                      {p.name}
                    </span>
                    {p.role === 'host' && (
                      <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 text-[9px] font-bold border border-blue-200/60">
                        HOST
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {p.designation || 'Participant'}
                  </p>
                </div>
              </div>

              {/* Action Controls for Participant */}
              <div className="flex items-center space-x-1.5">
                {p.isHandRaised && (
                  <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600 animate-bounce border border-amber-200/60">
                    <Hand className="w-3.5 h-3.5" />
                  </div>
                )}

                <button
                  onClick={() => onToggleMute(p.id)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    p.isMuted
                      ? 'bg-red-50 text-red-500 border border-red-100'
                      : 'hover:bg-slate-100 text-emerald-600'
                  }`}
                  title={p.isMuted ? 'Unmute' : 'Mute'}
                >
                  {p.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => onTogglePin(p.id)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    p.isPinned
                      ? 'bg-blue-600 text-white'
                      : 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                  }`}
                  title={p.isPinned ? 'Unpin' : 'Pin Video'}
                >
                  <Pin className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
