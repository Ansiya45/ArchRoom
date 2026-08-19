'use client';

import React, { useState } from 'react';
import { X, CalendarPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (meeting: { title: string; code: string; time: string }) => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('2026-07-22');
  const [time, setTime] = useState('14:00');
  const [loading, setLoading] = useState(false);
  const [meetingMode, setMeetingMode] = useState<'instant' | 'scheduled'>('instant');
  const navigate = useNavigate();

  const getMeetingOrigin = () =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  if (!isOpen) return null;


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);

    try {
      const payload = await trpc.meetings.create.mutate({
        title: title || 'Quick YLAAM-MEET Meeting',
        scheduledAt: meetingMode === 'scheduled' ? `${date}T${time}:00Z` : '',
        startNow: meetingMode === 'instant',
      });

      const createdCode = payload.meeting.meetingCode;

      onCreated({
        title: payload.meeting.title || title || 'Quick YLAAM-MEET Meeting',
        code: createdCode,
        time: meetingMode === 'scheduled' ? `${date} at ${time}` : 'Now',
      });

      setLoading(false);
      if (meetingMode === 'instant') {
        navigate(`/meet/${createdCode}`);
      } else {
        onClose();
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Something went wrong.');
      setLoading(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
          <CalendarPlus className="w-6 h-6 stroke-[2.2]" />
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1">Create or Schedule Meeting</h3>
        <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
          <button
            type="button"
            onClick={() => setMeetingMode('instant')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              meetingMode === 'instant'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            ⚡ Start Now
          </button>

          <button
            type="button"
            onClick={() => setMeetingMode('scheduled')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              meetingMode === 'scheduled'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            📅 Schedule Later
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Meeting Title */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Meeting Topic / Title
            </label>
            <input
              type="text"
              placeholder="e.g. Weekly Product Design Sync"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 text-sm focus:outline-none"
            />
          </div>

          {/* Schedule Only */}
          {meetingMode === 'scheduled' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200"
                />
              </div>
            </div>
          )}

        {/* Meeting Link */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          Meeting Link
          </label>

          <input
            type="text"
            readOnly
            value={`${getMeetingOrigin()}/meet/[generated-after-creation]`}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500"
          />
          <p className="mt-1.5 text-xs text-slate-500">The secure meeting link is available after the meeting is created.</p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold"
      >
        {meetingMode === "instant"
          ? (loading ? "Starting..." : "Start Meeting")
          : (loading ? "Scheduling..." : "Schedule Meeting")}
      </button>

    </form>


      </div>
    </div>
  );
};

export default ScheduleModal;
