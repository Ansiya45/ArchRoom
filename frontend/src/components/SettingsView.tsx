'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, Mic, Video, Volume2, Sparkles, Check, ShieldCheck, RefreshCw, Radio } from 'lucide-react';

interface SettingsViewProps {
  onShowToast: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onShowToast }) => {
  const [micDevice, setMicDevice] = useState('Default - MacBook Pro Microphone');
  const [camDevice, setCamDevice] = useState('FaceTime HD Camera (Built-in)');
  const [speakerDevice, setSpeakerDevice] = useState('Built-in Output Speakers');
  
  const [noiseCancel, setNoiseCancel] = useState(true);
  const [hdVideo, setHdVideo] = useState(true);
  const [autoMute, setAutoMute] = useState(false);
  const [bgBlur, setBgBlur] = useState(true);

  const [testingMic, setTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const handleTestMic = () => {
    if (testingMic) {
      setTestingMic(false);
      setMicLevel(0);
      return;
    }
    setTestingMic(true);
    let count = 0;
    const interval = setInterval(() => {
      setMicLevel(Math.floor(20 + Math.random() * 75));
      count++;
      if (count > 20) {
        clearInterval(interval);
        setTestingMic(false);
        setMicLevel(0);
      }
    }, 150);
  };

  const handleSave = () => {
    onShowToast('Settings saved successfully!');
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-6 sm:py-8 px-4 sm:px-6">
      <div className="flex items-center gap-2.5 text-blue-600 font-bold text-sm mb-1">
        <SlidersHorizontal className="w-5 h-5" />
        <span>System Preferences</span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2">
        Audio, Video & AI Intelligence
      </h2>
      <p className="text-slate-500 text-sm mb-8">
        Customize media devices, hardware acceleration, and real-time noise suppression.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Column: Device Configuration */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-5">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
            <Mic className="w-4 h-4 text-blue-600" />
            Media Devices & Input
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Microphone Input
            </label>
            <select
              value={micDevice}
              onChange={(e) => setMicDevice(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 text-sm focus:border-blue-500 focus:outline-none bg-slate-50 font-medium"
            >
              <option>Default - MacBook Pro Microphone</option>
              <option>External USB Audio Interface</option>
              <option>AirPods Pro (Bluetooth)</option>
            </select>
          </div>

          {/* Test Mic Button & Meter */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Microphone Input Level</span>
              <button
                onClick={handleTestMic}
                className="text-blue-600 hover:underline font-semibold cursor-pointer text-xs"
              >
                {testingMic ? 'Testing...' : 'Test Mic'}
              </button>
            </div>
            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-150 rounded-full"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Camera Feed
            </label>
            <select
              value={camDevice}
              onChange={(e) => setCamDevice(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 text-sm focus:border-blue-500 focus:outline-none bg-slate-50 font-medium"
            >
              <option>FaceTime HD Camera (Built-in)</option>
              <option>YLAAM-MEET 4K Pro Webcam</option>
              <option>Virtual Continuity Camera</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Speaker Output
            </label>
            <select
              value={speakerDevice}
              onChange={(e) => setSpeakerDevice(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 text-sm focus:border-blue-500 focus:outline-none bg-slate-50 font-medium"
            >
              <option>Built-in Output Speakers</option>
              <option>Headphones (3.5mm Output)</option>
              <option>External Monitor HDMI Audio</option>
            </select>
          </div>
        </div>

        {/* Right Column: AI & Quality Enhancements */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-5 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
              <Sparkles className="w-4 h-4 text-blue-600" />
              AI Enhancements & Quality
            </h3>

            <div className="space-y-3 mt-4">
              {/* AI Noise Suppression */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <div className="text-xs font-bold text-slate-900">AI Noise Suppression</div>
                  <div className="text-[11px] text-slate-500">Filters keyboard clacks and HVAC noise</div>
                </div>
                <button
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

              {/* Ultra HD Video */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <div className="text-xs font-bold text-slate-900">1080p Ultra HD Streaming</div>
                  <div className="text-[11px] text-slate-500">60fps low-bandwidth encoding</div>
                </div>
                <button
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

              {/* Background Blur */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <div className="text-xs font-bold text-slate-900">Smart Background Blur</div>
                  <div className="text-[11px] text-slate-500">Automatic portrait background isolation</div>
                </div>
                <button
                  onClick={() => setBgBlur(!bgBlur)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    bgBlur ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      bgBlur ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Auto Mute */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <div className="text-xs font-bold text-slate-900">Auto-Mute on Join</div>
                  <div className="text-[11px] text-slate-500">Join new calls with microphone off</div>
                </div>
                <button
                  onClick={() => setAutoMute(!autoMute)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    autoMute ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      autoMute ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={handleSave}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Save & Apply Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
