'use client';

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  Phone,
  Key,
  Calendar,
  Share2,
  Sparkles,
} from 'lucide-react';
import { MeetingInfoData } from '@/types/meeting';
import { copyToClipboard } from '@/utils/meetingHelpers';

interface MeetingInfoProps {
  info: MeetingInfoData;
  onClose: () => void;
}

export const MeetingInfo: React.FC<MeetingInfoProps> = ({ info, onClose }) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedFull, setCopiedFull] = useState(false);

  const handleCopyLink = async () => {
    const success = await copyToClipboard(info.inviteLink);
    if (success) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleCopyFullInvite = async () => {
    const fullText = `Join YLAAM-MEET Meeting\nTopic: ${info.title}\nMeeting ID: ${info.meetingId}\nPasscode: ${info.passcode}\nLink: ${info.inviteLink}\nDial-in: ${info.dialInNumber}`;
    const success = await copyToClipboard(fullText);
    if (success) {
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-lg bg-white/80 border border-white rounded-3xl p-6 text-slate-800 shadow-2xl relative space-y-6 backdrop-blur-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-blue-600 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Meeting Information</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">{info.title}</h2>
          <p className="text-xs text-slate-500">Hosted by {info.hostName}</p>
        </div>

        {/* Meeting Link Card */}
        <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100/80 space-y-3 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-700">
            <span className="font-bold">Shareable Meeting Link</span>
            <div className="flex items-center space-x-1 text-emerald-700 font-mono text-[11px] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>E2E Encrypted</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={info.inviteLink}
              className="flex-1 py-2.5 px-3 rounded-xl bg-white border border-blue-100 text-slate-800 text-xs font-mono select-all focus:outline-none shadow-sm"
            />
            <button
              onClick={handleCopyLink}
              className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-blue-200 transition-all active:scale-95"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-2xl bg-white/80 border border-blue-100/80 space-y-1 shadow-sm">
            <div className="flex items-center space-x-2 text-slate-500 text-xs">
              <Globe className="w-4 h-4 text-blue-600" />
              <span className="font-semibold">Meeting ID</span>
            </div>
            <p className="font-mono text-sm font-bold text-slate-900">{info.meetingId}</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/80 border border-blue-100/80 space-y-1 shadow-sm">
            <div className="flex items-center space-x-2 text-slate-500 text-xs">
              <Key className="w-4 h-4 text-amber-600" />
              <span className="font-semibold">Passcode</span>
            </div>
            <p className="font-mono text-sm font-bold text-slate-900">{info.passcode}</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/80 border border-blue-100/80 space-y-1 col-span-2 shadow-sm">
            <div className="flex items-center space-x-2 text-slate-500 text-xs">
              <Phone className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold">Dial-in Phone Audio</span>
            </div>
            <p className="font-mono text-xs font-medium text-slate-800">{info.dialInNumber}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={handleCopyFullInvite}
            className="w-full py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold border border-slate-200/80 flex items-center justify-center space-x-2 transition-all active:scale-95 shadow-sm"
          >
            {copiedFull ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Full Invitation Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4 text-slate-600" />
                <span>Copy Full Invitation</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
