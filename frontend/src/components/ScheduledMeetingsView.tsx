'use client';

import { RecurringOccurrences } from './RecurringOccurrences';
import { MeetingNotifications } from './MeetingNotifications';
import React, { useState } from 'react';
import { CalendarDays, Clock, Users, Video, Copy, Check, Star, Trash2, Plus, Search } from 'lucide-react';
import { MeetingItem } from './FavoritesView';
import type { MeetingRecord } from '../lib/meetingSchedule';

interface ScheduledMeetingsViewProps {
  meetings: MeetingItem[];
  startingCode?: string | null;
  hostUserId?: string;
  onRescheduleMeeting: (meeting: MeetingRecord) => void;
  onMeetingChanged: (meeting: MeetingRecord) => void;
  onStartMeeting: (meeting: MeetingItem, occurrenceId?: string) => void;
  onToggleFavorite: (id: string) => void;
  onDeleteMeeting: (id: string) => void;
  onOpenCreateModal: () => void;
}

export const ScheduledMeetingsView: React.FC<ScheduledMeetingsViewProps> = ({
  meetings,
  startingCode,
  hostUserId,
  onRescheduleMeeting,
  onStartMeeting,
  onMeetingChanged,
  onToggleFavorite,
  onDeleteMeeting,
  onOpenCreateModal,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMeetings = meetings.filter(
    (m) =>
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.hostName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopy = (id: string, code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 text-blue-600 font-bold text-sm mb-1">
            <CalendarDays className="w-5 h-5" />
            <span>Scheduled Meetings</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Your Upcoming Conferences
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Manage your booked calls, share room links, or jump right into your next meeting.
          </p>
        </div>

        <button
          onClick={onOpenCreateModal}
          className="px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New Meeting</span>
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="relative mb-6">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search by topic, room code, or host name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-slate-900 text-sm font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all shadow-xs"
        />
      </div>

      {filteredMeetings.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 shadow-sm max-w-md mx-auto my-8 space-y-3">
          <CalendarDays className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">No Meetings Found</h3>
          <p className="text-xs text-slate-500">
            {searchQuery ? 'No meetings matched your search query.' : 'You have no scheduled meetings yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMeetings.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-3xl p-5 shadow-lg shadow-slate-200/50 border border-slate-200/80 hover:border-blue-300 transition-all duration-200 flex flex-col justify-between space-y-4 group relative"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                  <span className="flex items-center gap-1 font-medium bg-slate-100 px-2.5 py-1 rounded-lg">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    {m.time}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onToggleFavorite(m.id)}
                      title={m.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        m.isFavorite ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-amber-400'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${m.isFavorite ? 'fill-amber-400' : ''}`} />
                    </button>
                    <button
                      onClick={() => onDeleteMeeting(m.id)}
                      title="Delete meeting"
                      className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {m.title}
                </h3>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                    {m.code}
                  </span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <Users className="w-3.5 h-3.5" /> {m.participantsCount} Invited
                  </span>
                </div>
              </div>

              {m.record && m.record.hostUserId === hostUserId && <MeetingNotifications meeting={m.record} />}
              {m.record?.scheduleType !== 'recurring' && m.record?.status === 'scheduled' && m.record.scheduledAt && m.record.hostUserId === hostUserId && (
                <button type="button" onClick={() => onRescheduleMeeting(m.record!)}
                  className="text-left text-xs font-semibold text-blue-600 hover:text-blue-700">Reschedule</button>
              )}
              {m.record?.scheduleType === 'recurring' && <RecurringOccurrences onChanged={onMeetingChanged} meeting={m.record} busy={startingCode === m.code} onStart={id => onStartMeeting(m, id)} />}
              <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <button
                  onClick={() => onStartMeeting(m)}
                  disabled={startingCode === m.code || !!m.record?.recurrenceCancelledAt || (m.record?.scheduleType === 'one_time' && m.record.status === 'ended')}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Video className="w-3.5 h-3.5" />
                  {m.record?.recurrenceCancelledAt ? 'Series cancelled' : startingCode === m.code ? 'Starting...' : m.record?.scheduleType === 'one_time' && m.record.status === 'ended' ? 'Ended' : m.record?.scheduleType === 'recurring' ? (m.record.status === 'live' ? 'Join occurrence' : 'Start next occurrence') : 'Start Call'}
                </button>

                <button
                  onClick={() => handleCopy(m.id, m.code)}
                  className="p-2.5 rounded-xl border border-slate-200 hover:border-blue-300 text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 transition-colors cursor-pointer"
                  title="Copy Meeting Link"
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

export default ScheduledMeetingsView;
