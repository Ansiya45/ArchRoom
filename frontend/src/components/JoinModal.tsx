import { startHostedMeeting } from '../lib/startHostedMeeting';
'use client';

import React, { useRef, useState } from 'react';
import { X, Video, KeyRound, Sparkles, ArrowRight } from 'lucide-react';
import { getStoredUser } from '../lib/auth';
import { trpc } from '../lib/trpc';

interface JoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinSuccess: (code: string, name: string, participantId: string, joinRequestId: string, occurrenceId?: string) => void;
  accountName: string;
}

export const JoinModal: React.FC<JoinModalProps> = ({
  isOpen,
  onClose,
  onJoinSuccess,
  accountName,
}) => {
  const [meetingCode, setMeetingCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const joiningRef = useRef(false);
  const joinRequestIdRef = useRef(crypto.randomUUID());

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingCode.trim() || joiningRef.current) return;
    joiningRef.current = true;
    setIsJoining(true);

    try {
      let { meeting: room } = await trpc.meetings.getByCode.query({ meetingCode: meetingCode.trim() });
      if ((room.scheduleType === 'reusable' || room.scheduleType === 'recurring') && !room.activeOccurrenceId && room.hostUserId === getStoredUser()?.id) {
        ({ meeting: room } = await startHostedMeeting(room));
      }
      const payload = await trpc.meetings.join.mutate({
        occurrenceId: room.activeOccurrenceId ?? undefined,
        meetingCode: meetingCode.trim(),
        joinRequestId: joinRequestIdRef.current,
      });

      onJoinSuccess(
        payload.meeting.meetingCode,
        accountName,
        payload.participant.id,
        joinRequestIdRef.current,
        payload.participant.occurrenceId ?? undefined
      );
      onClose();
    } catch (error) {
      joiningRef.current = false;
      setIsJoining(false);
      alert(error instanceof Error ? error.message : 'Unable to join the meeting.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
          <Video className="w-6 h-6 stroke-[2.2]" />
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1">Join YLAAM-MEET Meeting</h3>
        <p className="text-sm text-slate-500 mb-6">
          Enter the meeting code or invitation link provided by the host.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Meeting Code / Link
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder="e.g. YLM-982-310"
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 text-sm font-medium focus:outline-none transition-all"
              />
            </div>
          </div>

          <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Joining as <strong>{accountName}</strong>. Participant email delivery uses your signed-in account.</p>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isJoining}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
            >
              <span>{isJoining ? 'Joining...' : 'Join Call Now'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1 text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" /> No downloads required
          </span>
          <span className="text-slate-400">HD 1080p WebRTC</span>
        </div>
      </div>
    </div>
  );
};

export default JoinModal;
