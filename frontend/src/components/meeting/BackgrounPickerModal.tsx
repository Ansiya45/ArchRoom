'use client';

import React, { useState } from 'react';
import { X, Check, Palette, Sparkles, Ban, Droplets, Building2, Sun } from 'lucide-react';
import { BackgroundChoice } from '@/types/meeting';
import { BACKGROUND_PRESETS } from '@/utils/meetingHelpers';
import { CameraVideo } from './CameraVideo';

interface BackgroundPickerModalProps {
  activeBg: BackgroundChoice;
  onApplyBg: (bg: BackgroundChoice) => void;
  onClose: () => void;
  localStream?: MediaStream | null;
  isCameraOn?: boolean;
}

const getPresetIcon = (id: BackgroundChoice) => {
  switch (id) {
    case 'none':
      return <Ban className="w-5 h-5" />;
    case 'blur':
      return <Droplets className="w-5 h-5" />;
    case 'office':
      return <Building2 className="w-5 h-5" />;
    case 'skyline':
      return <Sun className="w-5 h-5" />;
    case 'studio':
      return <Sparkles className="w-5 h-5" />;
    default:
      return <Palette className="w-5 h-5" />;
  }
};

export const BackgroundPickerModal: React.FC<BackgroundPickerModalProps> = ({
  activeBg,
  onApplyBg,
  onClose,
  localStream,
  isCameraOn = true,
}) => {
  const [previewBg, setPreviewBg] = useState<BackgroundChoice>(activeBg);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl bg-white/85 border border-white rounded-3xl p-6 text-slate-800 shadow-2xl relative space-y-5 backdrop-blur-2xl max-h-[92vh] overflow-y-auto">
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
            <Palette className="w-4 h-4" />
            <span>In-Call Virtual Backgrounds</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Choose Virtual Background</h2>
          <p className="text-xs text-slate-500">
            Preview an effect privately, then apply it when you are ready.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">Live preview</span>
            <span className="text-[11px] text-slate-500">Only your video is affected</span>
          </div>
          <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-lg">
            <CameraVideo
              isCameraOn={isCameraOn}
              activeBg={previewBg}
              mediaStream={localStream}
              isSelf
            />
          </div>
        </div>

        {/* Background Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
          {BACKGROUND_PRESETS.map((preset) => {
            const isSelected = previewBg === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setPreviewBg(preset.id as BackgroundChoice)}
                className={`p-3 rounded-2xl border text-left transition-all relative flex flex-col justify-between space-y-2.5 overflow-hidden group ${
                  isSelected
                    ? 'bg-blue-50/90 border-blue-600 ring-2 ring-blue-400/50 shadow-md shadow-blue-100'
                    : 'bg-white/80 border-blue-100/80 hover:border-blue-300 hover:bg-white'
                }`}
              >
                {/* Thumbnail / Visual Box */}
                <div className="w-full h-24 rounded-xl overflow-hidden relative bg-slate-100 border border-slate-200/60 flex items-center justify-center">
                  {preset.thumbnail ? (
                    <img
                      src={preset.thumbnail}
                      alt={preset.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-500 space-y-1">
                      {getPresetIcon(preset.id as BackgroundChoice)}
                    </div>
                  )}

                  {/* Active selection badge */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-bold flex items-center space-x-1 shadow-md">
                      <Check className="w-3 h-3" />
                      <span>Active</span>
                    </div>
                  )}
                </div>

                {/* Info Text */}
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                    <span>{preset.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                    {preset.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Done Button */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={() => {
              onApplyBg(previewBg);
              onClose();
            }}
            className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-200 transition-all active:scale-95"
          >
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
};
