'use client';

import React, { useState } from 'react';
import { Star, Video, Trash2, Copy, Check, Clock, Users, Plus, ExternalLink } from 'lucide-react';

export interface MeetingItem {
  id: string;
  title: string;
  code: string;
  time: string;
  participantsCount: number;
  hostName: string;
  isFavorite: boolean;
}

interface FavoritesViewProps {
  meetings: MeetingItem[];
  onStartMeeting: (meeting: MeetingItem) => void;
  onToggleFavorite: (id: string) => void;
  onOpenCreateModal: () => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  meetings,
  onStartMeeting,
  onToggleFavorite,
  onOpenCreateModal,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const favoriteMeetings = meetings.filter((m) => m.isFavorite);

  const handleCopy = (id: string, code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-6 sm:py-8 px-4 sm:px-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-amber-500 font-bold text-sm mb-1">
            <Star className="w-5 h-5 fill-amber-400 text-amber-500" />
            <span>Favorite Meeting Rooms</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Quick Access Boardrooms
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Bookmarked spaces for instant collaboration and daily team standups.
          </p>
        </div>

        <button
          onClick={onOpenCreateModal}
          className="px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New Room</span>
        </button>
      </div>

      {favoriteMeetings.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 shadow-sm max-w-md mx-auto my-8 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto border border-amber-100">
            <Star className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">No Favorites Saved Yet</h3>
          <p className="text-sm text-slate-500">
            Star your most frequently used room codes from the Scheduled Meetings tab to access them quickly here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {favoriteMeetings.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-3xl p-5 shadow-lg shadow-slate-200/50 border border-slate-200/80 hover:border-amber-300 transition-all duration-200 flex flex-col justify-between space-y-4 group relative"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span className="flex items-center gap-1 font-medium bg-slate-100 px-2.5 py-1 rounded-lg">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    {m.time}
                  </span>
                  <button
                    onClick={() => onToggleFavorite(m.id)}
                    title="Remove from favorites"
                    className="text-amber-500 hover:text-amber-600 p-1.5 rounded-xl hover:bg-amber-50 transition-colors cursor-pointer"
                  >
                    <Star className="w-4 h-4 fill-amber-400" />
                  </button>
                </div>

                <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {m.title}
                </h3>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg font-semibold">
                    {m.code}
                  </span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <Users className="w-3.5 h-3.5" /> {m.participantsCount} Guests
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  onClick={() => onStartMeeting(m)}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Video className="w-3.5 h-3.5" />
                  Enter Call
                </button>

                <button
                  onClick={() => handleCopy(m.id, m.code)}
                  className="p-2.5 rounded-xl border border-slate-200 hover:border-blue-300 text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors cursor-pointer"
                  title="Copy Room Link"
                >
                  {copiedId === m.id ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FavoritesView;
