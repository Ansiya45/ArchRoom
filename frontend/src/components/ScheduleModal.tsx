'use client';

import React, { useState } from 'react';
import { X, CalendarPlus, Copy, Check, Video, Clock, Users, ArrowRight, Link } from 'lucide-react';

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
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleGenerateInstant = () => {
    const randomCode = `arch-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
    setGeneratedCode(randomCode);
  };

  const handleCopyLink = () => {
    const link = `https://archroom.app/meet/${generatedCode || 'arch-772-910'}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = generatedCode || `arch-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
    onCreated({
      title: title || 'Quick ArchRoom Meeting',
      code,
      time: `${date} at ${time}`,
    });
    onClose();
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
        <p className="text-sm text-slate-500 mb-6">
          Generate an instant meeting room or schedule an upcoming conference with your team.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Meeting Topic / Title
            </label>
            <input
              type="text"
              placeholder="e.g. Weekly Product Design Sync"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-slate-900 text-sm font-medium focus:outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm font-medium focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm font-medium focus:outline-none"
              />
            </div>
          </div>

          {/* Generated Link Box */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
              <span className="flex items-center gap-1.5">
                <Link className="w-3.5 h-3.5 text-blue-600" /> Meeting Link
              </span>
              <button
                type="button"
                onClick={handleGenerateInstant}
                className="text-blue-600 hover:underline cursor-pointer text-[11px]"
              >
                Generate New Code
              </button>
            </div>
            <div className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-800">
              <span className="truncate">
                https://archroom.app/meet/{generatedCode || 'arch-392-810'}
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer ml-2 shrink-0"
                title="Copy Link"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-3 flex gap-3">
            <button
              type="submit"
              className="flex-1 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
            >
              <Video className="w-4 h-4" />
              <span>Start Instant Meeting</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ScheduleModal;
