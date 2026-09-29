'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, CalendarPlus, Copy, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { localScheduleFields, type MeetingRecord } from '../lib/meetingSchedule';

import { RecurrenceControls, type Rule } from './RecurrenceControls';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (meeting: MeetingRecord) => void;
  editingMeeting?: MeetingRecord | null;
  onUpdated: (meeting: MeetingRecord) => void;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateMeetingCode() {
  const values = crypto.getRandomValues(new Uint8Array(6));
  return `YLM-${Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')}`;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  editingMeeting,
  onUpdated,
}) => {
  const [recurrence, setRecurrence] = useState<Rule | null>(null);
  const [title, setTitle] = useState('');
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [date, setDate] = useState(() => localScheduleFields(new Date(), timeZone).date);
  const [time, setTime] = useState('14:00');
  const [loading, setLoading] = useState(false);
  const [meetingCode, setMeetingCode] = useState(generateMeetingCode);
  const [copied, setCopied] = useState(false);
  const [meetingMode, setMeetingMode] = useState<'instant' | 'scheduled' | 'reusable'>('instant');
  const navigate = useNavigate();
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const timeZones = Array.from(new Set([timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])]));

  const getMeetingOrigin = () =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const meetingLink = `${getMeetingOrigin()}/meet/${meetingCode}`;

  useEffect(() => {
    if (isOpen) {
      const zone = editingMeeting?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const fields = localScheduleFields(editingMeeting?.scheduledAt ? new Date(editingMeeting.scheduledAt) : new Date(), zone);
      setTimeZone(zone);
      setDate(fields.date);
      setTime(editingMeeting ? fields.time : '14:00');
      setTitle(editingMeeting?.title || '');
      setMeetingMode(editingMeeting ? 'scheduled' : 'instant');
      setMeetingCode(editingMeeting?.meetingCode || generateMeetingCode());
      setRecurrence(null);
      setError('');
      setCopied(false);
    }
  }, [isOpen, editingMeeting]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(meetingLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    try {
      const schedule = { localDateTime: `${date}T${time}`, timeZone };
      if (editingMeeting) {
        const payload = await trpc.meetings.reschedule.mutate({ meetingId: editingMeeting.id, schedule });
        onUpdated(payload.meeting);
        onClose();
      } else {
        const payload = await trpc.meetings.create.mutate({
          title: title || 'Quick YLAAM-MEET Meeting', meetingCode,
          ...(meetingMode === 'scheduled' ? { schedule, ...(recurrence ? { recurrence } : {}) } : {}),
          startNow: meetingMode === 'instant',
          reusable: meetingMode === 'reusable',
        });
        onCreated(payload.meeting);
        onClose();
        if (meetingMode === 'instant') navigate(`/meet/${payload.meeting.meetingCode}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save this meeting.';
      setError(message);
      if (!editingMeeting && message.includes('Meeting code is already in use')) setMeetingCode(generateMeetingCode());
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="meeting-form-title" className="bg-white rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto w-full p-6 sm:p-7 shadow-2xl border border-slate-100 relative">
        <button
          onClick={onClose}
          disabled={loading}
          aria-label="Close meeting form"
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
          <CalendarPlus className="w-6 h-6 stroke-[2.2]" />
        </div>

        <h3 id="meeting-form-title" className="text-xl font-bold text-slate-900 mb-1">{editingMeeting ? 'Reschedule Meeting' : 'Create or Schedule Meeting'}</h3>
        {!editingMeeting && <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
          <button
            type="button"
            disabled={loading}
            aria-pressed={meetingMode === 'instant'}
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
            disabled={loading}
            aria-pressed={meetingMode === 'scheduled'}
            onClick={() => setMeetingMode('scheduled')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              meetingMode === 'scheduled'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            📅 Schedule Later
          </button>
          <button type="button" disabled={loading} aria-pressed={meetingMode === 'reusable'} onClick={() => setMeetingMode('reusable')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${meetingMode === 'reusable' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-200'}`}>
            No fixed time
          </button>
        </div>}
        {meetingMode === 'reusable' && <p className="mb-4 text-sm text-slate-500">Create a reusable room link. Open a new session whenever needed; participants wait for your admission each time.</p>}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Meeting Title */}
          <div>
            <label htmlFor="meeting-title" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Meeting Topic / Title
            </label>
            <input
              type="text"
              id="meeting-title"
              placeholder="e.g. Weekly Product Design Sync"
              value={title}
              readOnly={!!editingMeeting}
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
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Time</label>
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200"
                />
              </div>
            </div>
          )}
          {meetingMode === 'scheduled' && (
            <div>
              <label htmlFor="meeting-timezone" className="block text-xs font-semibold mb-1.5">Timezone</label>
              <select id="meeting-timezone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}
                className="w-full px-3 py-3 rounded-xl border border-slate-200 text-sm">
                {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              {!editingMeeting?.timeZone && editingMeeting && <p className="mt-1 text-xs text-slate-500">The original timezone was not recorded. Confirm the date, time and timezone before saving.</p>}
            </div>
          )}
          {meetingMode === 'scheduled' && !editingMeeting && <RecurrenceControls key={String(isOpen)} value={recurrence} onChange={setRecurrence} date={date} />}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* Meeting Link */}
        <div>
          <label htmlFor="meeting-link" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          Meeting Link
          </label>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              type="text"
              id="meeting-link"
              readOnly
              value={meetingLink}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => void handleCopyLink()}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{editingMeeting ? 'Rescheduling keeps this same meeting link.' : 'This exact link becomes active when you create the meeting.'}</p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold"
      >
        {editingMeeting ? (loading ? "Saving..." : "Save Schedule") : meetingMode === "reusable" ? (loading ? "Creating..." : "Create Reusable Room") : meetingMode === "instant"
          ? (loading ? "Starting..." : "Start Meeting")
          : (loading ? "Scheduling..." : "Schedule Meeting")}
      </button>

    </form>


      </div>
    </div>
  );
};

export default ScheduleModal;
