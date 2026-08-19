'use client';

import React, { useState } from 'react';
import { X, Mic, Video, Volume2, ShieldCheck, Sparkles, SlidersHorizontal, Check } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [noiseCancel, setNoiseCancel] = useState(true);
  const [hdVideo, setHdVideo] = useState(true);
  const [autoMute, setAutoMute] = useState(false);
  const [micDevice, setMicDevice] = useState('Default - MacBook Pro Microphone');
  const [camDevice, setCamDevice] = useState('FaceTime HD Camera (Built-in)');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
          <SlidersHorizontal className="w-6 h-6 stroke-[2.2]" />
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1">YLAAM-MEET Settings</h3>
        <p className="text-sm text-slate-500 mb-6">
          Configure your audio, video feeds and AI enhancement preferences.
        </p>

        <div className="space-y-4 text-xs font-medium">
          {/* Audio Input */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1.5 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-blue-600" /> Microphone Input
            </label>
            <select
              value={micDevice}
              onChange={(e) => setMicDevice(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:border-blue-500 focus:outline-none bg-slate-50"
            >
              <option>Default - MacBook Pro Microphone</option>
              <option>External USB Audio Interface</option>
              <option>AirPods Pro (Bluetooth)</option>
            </select>
          </div>

          {/* Camera Input */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1.5 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-blue-600" /> Camera Feed
            </label>
            <select
              value={camDevice}
              onChange={(e) => setCamDevice(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 focus:border-blue-500 focus:outline-none bg-slate-50"
            >
              <option>FaceTime HD Camera (Built-in)</option>
              <option>YLAAM-MEET 4K Pro Webcam</option>
              <option>Virtual Continuity Camera</option>
            </select>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            {/* AI Noise Cancellation */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-200/60">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-slate-900 font-bold">AI Noise Suppression</div>
                  <div className="text-[11px] text-slate-500">Filter background keyboard & room acoustics</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNoiseCancel(!noiseCancel)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  noiseCancel ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    noiseCancel ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Ultra HD 1080p */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-200/60">
              <div className="flex items-center gap-2.5">
                <Video className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-slate-900 font-bold">1080p Ultra HD Video</div>
                  <div className="text-[11px] text-slate-500">Stream at 60fps with low memory usage</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHdVideo(!hdVideo)}
                className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                  hdVideo ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    hdVideo ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/20 active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
