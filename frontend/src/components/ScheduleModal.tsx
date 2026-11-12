'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, CalendarPlus, Copy, Check, Settings, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { localScheduleFields, type MeetingRecord } from '../lib/meetingSchedule';

import { RecurrenceControls, type Rule } from './RecurrenceControls';
import BatchStudents from './BatchStudents';

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (meeting: MeetingRecord) => void;
  editingMeeting?: MeetingRecord | null;
  onUpdated: (meeting: MeetingRecord, action: 'reschedule' | 'recordingSettings') => void;
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
  const [meetingMode, setMeetingMode] = useState<'instant' | 'scheduled'>('instant');
  const [recordingSettingsOpen, setRecordingSettingsOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderState, setFolderState] = useState<{ connected: boolean; canCreate: boolean; folders: { id: string; name: string }[] } | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
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
      setRecordingSettingsOpen(false);
      setSelectedFolderId(editingMeeting?.recordingFolderId ?? null);
      setFolderState(null);
      setFolderError('');
      setNewFolderName('');
    }
  }, [isOpen, editingMeeting]);

  useEffect(() => {
    if (!isOpen || !recordingSettingsOpen) return;
    let active = true;
    setFolderLoading(true);
    void trpc.recordingFolders.list.query().then(result => { if (active) setFolderState(result); })
      .catch(() => { if (active) { setFolderState({ connected: false, canCreate: false, folders: [] }); setFolderError('Recording folders could not be loaded.'); } })
      .finally(() => { if (active) setFolderLoading(false); });
    return () => { active = false; };
  }, [isOpen, recordingSettingsOpen]);

  const refreshFolders = async () => {
    setFolderLoading(true); setFolderError('');
    try { setFolderState(await trpc.recordingFolders.refresh.mutate()); }
    catch { setFolderState({ connected: false, canCreate: false, folders: [] }); setFolderError('Recording folders could not be refreshed.'); }
    finally { setFolderLoading(false); }
  };

  const createFolder = async () => {
    setFolderLoading(true); setFolderError('');
    try {
      const created = await trpc.recordingFolders.create.mutate({ name: newFolderName });
      setFolderState(await trpc.recordingFolders.refresh.mutate());
      setSelectedFolderId(created.id);
      setNewFolderName('');
    } catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Batch folder could not be created.'); }
    finally { setFolderLoading(false); }
  };

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
        if (selectedFolderId !== editingMeeting.recordingFolderId) {
          const settings = await trpc.meetings.updateRecordingSettings.mutate({ meetingId: editingMeeting.id,
            recordingFolderId: selectedFolderId, recordingAccessPolicy: editingMeeting.recordingAccessPolicy });
          onUpdated(settings.meeting, 'recordingSettings');
        } else onUpdated(payload.meeting, 'reschedule');
        onClose();
      } else {
        const payload = await trpc.meetings.create.mutate({
          title: title || 'Quick YLAAM-MEET Meeting', meetingCode,
          ...(meetingMode === 'scheduled' ? { schedule, ...(recurrence ? { recurrence } : {}) } : {}),
          startNow: false,
          reusable: meetingMode === 'instant',
          recordingFolderId: selectedFolderId,
          recordingAccessPolicy: 'private',
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
      <div role="dialog" aria-modal="true" aria-labelledby="meeting-form-title" className="bg-white rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto w-full p-6 sm:p-7 shadow-xl border border-slate-200 relative text-white [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-blue-400 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-2 [&_input:focus-visible]:outline-blue-400 [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-offset-2 [&_select:focus-visible]:outline-blue-400 [&_input]:accent-blue-500 [&_input::placeholder]:text-slate-400">
        <button
          onClick={onClose}
          disabled={loading}
          aria-label="Close meeting form"
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-300 flex items-center justify-center mb-4 border border-blue-500/20">
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
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Create Meeting
          </button>

          <button
            type="button"
            disabled={loading}
            aria-pressed={meetingMode === 'scheduled'}
            onClick={() => setMeetingMode('scheduled')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              meetingMode === 'scheduled'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            Schedule Meeting
          </button>
        </div>}
        {meetingMode === 'instant' && <p className="mb-4 text-sm text-slate-500">Reuse this link whenever you need a meeting. You remain the host and open each session from the join page.</p>}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Meeting Title */}
          <div>
            <label htmlFor="meeting-title" className="block text-xs font-semibold text-white uppercase tracking-wider mb-1.5">
              Meeting Topic / Title
            </label>
            <input
              type="text"
              id="meeting-title"
              placeholder="e.g. Weekly Product Design Sync"
              value={title}
              readOnly={!!editingMeeting}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-white text-sm"
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
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">Time</label>
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-white"
                />
              </div>
            </div>
          )}
          {meetingMode === 'scheduled' && (
            <div>
              <label htmlFor="meeting-timezone" className="block text-xs font-semibold mb-1.5">Timezone</label>
              <select id="meeting-timezone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}
                className="schedule-dark-options w-full px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-white text-sm">
                {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              {!editingMeeting?.timeZone && editingMeeting && <p className="mt-1 text-xs text-slate-500">The original timezone was not recorded. Confirm the date, time and timezone before saving.</p>}
            </div>
          )}
          {meetingMode === 'scheduled' && !editingMeeting && <RecurrenceControls key={String(isOpen)} value={recurrence} onChange={setRecurrence} date={date} />}
          <div className="rounded-xl border border-slate-200 p-3">
            <button type="button" aria-expanded={recordingSettingsOpen} aria-controls="recording-settings-preview"
              onClick={() => setRecordingSettingsOpen(open => !open)}
              className="flex w-full items-center gap-2 text-left rounded-md text-sm font-semibold text-white hover:text-blue-300 transition-colors">
              <Settings className="h-4 w-4" /> Settings <span className="ml-auto text-xs font-normal text-slate-500">Recording preview</span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-blue-300 transition-transform motion-reduce:transition-none ${recordingSettingsOpen ? 'rotate-180' : ''}`} />
            </button>
            {recordingSettingsOpen && <section id="recording-settings-preview" aria-label="Recording Settings" className="mt-3 space-y-4 border-t border-slate-200 pt-3 text-sm">
              <div>
                <h4 className="font-semibold text-slate-900">Recording Settings</h4>
                <p className="mt-1 rounded-lg border border-blue-500/20 bg-blue-500/10 p-2 text-xs text-blue-200">Optionally choose an authorized company folder. Finalized recordings will upload there automatically; otherwise you can choose a folder after recording.</p>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-white">Recording destination</p>
                <label htmlFor="recording-folder-preview" className="block text-xs text-slate-500">Optional company Drive folder for this meeting or recurring series</label>
                <select id="recording-folder-preview" value={selectedFolderId ?? ''} onChange={event => setSelectedFolderId(event.target.value || null)}
                  disabled={folderLoading || !folderState?.connected} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-700 disabled:opacity-60">
                  <option value="">Choose after recording</option>
                  {folderState?.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                {!folderState?.connected && !folderLoading && <p className="text-xs text-slate-500">Google Drive is not connected or the recording root is not verified. Batch folders are unavailable.</p>}
                {folderLoading && <p role="status" className="text-xs text-slate-500">Loading verified folders...</p>}
                {folderError && <p role="alert" className="text-xs text-red-700">{folderError}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={folderLoading || !folderState?.connected} onClick={() => void refreshFolders()} className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs hover:bg-slate-200 transition-colors disabled:opacity-50">Refresh Folders</button>
                  {folderState?.canCreate && <><input aria-label="New batch folder name" value={newFolderName} onChange={event => setNewFolderName(event.target.value)} maxLength={255} className="rounded-lg border border-slate-200 bg-slate-50 text-white px-3 py-2 text-xs" />
                    <button type="button" disabled={folderLoading || !newFolderName.trim()} onClick={() => void createFolder()} className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs hover:bg-slate-200 transition-colors disabled:opacity-50">Create New Batch Folder</button></>}
                </div>
              </div>
              {selectedFolderId && !folderLoading && folderState?.connected && folderState.folders.some(folder => folder.id === selectedFolderId) &&
                <BatchStudents key={selectedFolderId} folderId={selectedFolderId} folderName={folderState.folders.find(folder => folder.id === selectedFolderId)!.name} />}
              <p className="text-xs text-slate-500">Manage recording access in Google Drive.</p>
            </section>}
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* Meeting Link */}
        <div>
          <label htmlFor="meeting-link" className="block text-xs font-semibold text-white uppercase tracking-wider mb-1.5">
          Meeting Link
          </label>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              type="text"
              id="meeting-link"
              readOnly
              value={meetingLink}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 px-4 py-3 rounded-xl border border-blue-400/40 bg-blue-500/10 text-blue-200 font-mono text-sm"
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
        className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
      >
        {editingMeeting ? (loading ? "Saving..." : "Save Schedule") : meetingMode === "instant"
          ? (loading ? "Creating..." : "Create Meeting")
          : (loading ? "Scheduling..." : "Schedule Meeting")}
      </button>

    </form>


      </div>
    </div>
  );
};

export default ScheduleModal;
