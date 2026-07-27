'use client';

import React from 'react';
import { Video, Plus, ShieldCheck, Zap, Users } from 'lucide-react';

interface HeroContentProps {
  onJoinMeeting: () => void;
  onCreateMeeting: () => void;
}

export const HeroContent: React.FC<HeroContentProps> = ({
  onJoinMeeting,
  onCreateMeeting,
}) => {
  return (
    <div className="flex flex-col items-start justify-center max-w-lg">
      {/* Pill Badge */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-3 shadow-2xs">
        <span className="flex h-1.5 w-1.5 rounded-full bg-blue-600 animate-ping" />
        <span className="flex h-1.5 w-1.5 rounded-full bg-blue-600 -ml-3" />
        <span>HD Video & AI Meeting Intelligence</span>
      </div>

      {/* Main Headline */}
      <h1 className="text-3xl sm:text-4xl lg:text-4xl font-extrabold leading-tight text-slate-900 mb-3 tracking-tight">
        Meet Without <span className="text-blue-600">Limits</span>, <br />
        Collaborate Effortlessly.
      </h1>

      {/* Subtitle */}
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-md mb-4">
        ArchRoom brings teams together with crystal-clear video, real-time collaboration and intelligent tools.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full mb-5">
        {/* Create Meeting Button */}
        <button
          onClick={onCreateMeeting}
          className="px-5 py-2.5 bg-blue-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-blue-200 hover:scale-[1.02] hover:bg-blue-700 transition-all flex items-center justify-center gap-2 group active:scale-98 cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Create Meeting</span>
        </button>

        {/* Join Meeting Button */}
        <button
          onClick={onJoinMeeting}
          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl shadow-2xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 group active:scale-98 cursor-pointer"
        >
          <Video className="w-4 h-4 text-slate-600" />
          <span>Join Meeting</span>
        </button>
      </div>

      {/* Feature Highlights Trust Badges */}
      <div className="pt-3 grid grid-cols-3 gap-2 border-t border-slate-200 w-full text-slate-500 text-[11px] font-medium">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>End-to-End Encrypted</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>Ultra-Low Latency</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>Up to 250 Guests</span>
        </div>
      </div>
    </div>
  );
};

export default HeroContent;
