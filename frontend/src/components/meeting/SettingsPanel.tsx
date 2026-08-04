'use client';

import React, { useState } from 'react';
import {
  X,
  Mic,
  Video,
  Wifi,
  Sliders,
  Volume2,
  Sparkles,
  Ban,
  Droplets,
  Building2,
  Sun,
  Palette,
  Check,
} from 'lucide-react';
import { DeviceSettings, BackgroundChoice } from '@/types/meeting';

interface SettingsPanelProps {
  deviceSettings: DeviceSettings;
  setDeviceSettings: React.Dispatch<React.SetStateAction<DeviceSettings>>;
  onClose: () => void;
}

interface BackgroundPreset {
  id: BackgroundChoice;
  name: string;
  thumbnail?: string;
  icon: React.ReactNode;
}

const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: 'none',
    name: 'Original Video',
    icon: <Ban className="w-4 h-4" />,
  },
  {
    id: 'blur',
    name: 'Soft Studio Blur',
    icon: <Droplets className="w-4 h-4" />,
  },
  {
    id: 'office',
    name: 'Architectural Office',
    thumbnail: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&auto=format&fit=crop&q=80',
    icon: <Building2 className="w-4 h-4" />,
  },
  {
    id: 'skyline',
    name: 'Penthouse Skyline',
    thumbnail: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=300&auto=format&fit=crop&q=80',
    icon: <Sun className="w-4 h-4" />,
  },
  {
    id: 'studio',
    name: 'Zen Studio',
    thumbnail: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&auto=format&fit=crop&q=80',
    icon: <Sparkles className="w-4 h-4" />,
  },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  deviceSettings,
  setDeviceSettings,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'video' | 'network' | 'general'>('audio');
  const [isTestingAudio, setIsTestingAudio] = useState(false);

  const handleTestAudio = () => {
    setIsTestingAudio(true);
    setTimeout(() => setIsTestingAudio(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl bg-white/80 border border-white rounded-3xl p-6 sm:p-8 text-slate-800 shadow-2xl relative space-y-6 max-h-[90vh] flex flex-col backdrop-blur-2xl">
        {/* Modal Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-blue-600" />
            <span>Audio & Video Preferences</span>
          </h2>
          <p className="text-xs text-slate-500">
            Configure hardware devices and stream quality for ArchRoom.
          </p>
        </div>

        {/* Tab Header */}
        <div className="flex border-b border-blue-100/60 space-x-2">
          {(['audio', 'video', 'network', 'general'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2.5 px-4 text-xs font-bold uppercase tracking-wider capitalize transition-all border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1 scrollbar-thin scrollbar-thumb-slate-200">
          {activeTab === 'audio' && (
            <div className="space-y-4">
              {/* Microphone Select */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                  <Mic className="w-4 h-4 text-blue-600" />
                  <span>Microphone Device</span>
                </label>
                <select
                  value={deviceSettings.micId}
                  onChange={(e) =>
                    setDeviceSettings((prev) => ({ ...prev, micId: e.target.value }))
                  }
                  className="w-full py-3 px-4 rounded-2xl bg-white border border-blue-100 text-slate-800 text-xs sm:text-sm font-medium focus:outline-none focus:border-blue-500 shadow-sm"
                >
                  <option value="default-mic">Built-in Microphone (MacBook Pro Array)</option>
                  <option value="external-mic">USB Studio Condenser Mic (Podcast Pro)</option>
                  <option value="bluetooth-mic">AirPods Pro Bluetooth Mic</option>
                </select>
              </div>

              {/* Speaker Select & Test */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                  <span>Speaker Output</span>
                </label>
                <div className="flex items-center space-x-3">
                  <select
                    value={deviceSettings.speakerId}
                    onChange={(e) =>
                      setDeviceSettings((prev) => ({ ...prev, speakerId: e.target.value }))
                    }
                    className="flex-1 py-3 px-4 rounded-2xl bg-white border border-blue-100 text-slate-800 text-xs sm:text-sm font-medium focus:outline-none focus:border-blue-500 shadow-sm"
                  >
                    <option value="default-speaker">Built-in Speakers (MacBook Pro)</option>
                    <option value="headphones">AirPods Pro Headset</option>
                  </select>
                  <button
                    onClick={handleTestAudio}
                    className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200/80 transition-all shadow-sm"
                  >
                    {isTestingAudio ? 'Playing Chime...' : 'Test Sound'}
                  </button>
                </div>
              </div>

              {/* AI Noise Cancellation */}
              <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100/80 flex items-center justify-between shadow-sm">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>AI Deep Noise Suppression</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Filters out keyboard typing, dogs, fan noise, and room echoes.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={deviceSettings.noiseCancellation}
                  onChange={(e) =>
                    setDeviceSettings((prev) => ({
                      ...prev,
                      noiseCancellation: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 rounded bg-white border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {activeTab === 'video' && (
            <div className="space-y-4">
              {/* Camera Device */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                  <Video className="w-4 h-4 text-blue-600" />
                  <span>Camera Sensor</span>
                </label>
                <select
                  value={deviceSettings.cameraId}
                  onChange={(e) =>
                    setDeviceSettings((prev) => ({ ...prev, cameraId: e.target.value }))
                  }
                  className="w-full py-3 px-4 rounded-2xl bg-white border border-blue-100 text-slate-800 text-xs sm:text-sm font-medium focus:outline-none focus:border-blue-500 shadow-sm"
                >
                  <option value="default-camera">FaceTime HD Camera (1080p Built-in)</option>
                  <option value="external-webcam">Logitech Brio 4K Stream Cam</option>
                </select>
              </div>

              {/* Virtual Background Options (5 Collection) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                  <Palette className="w-4 h-4 text-blue-600" />
                  <span>Virtual Background Presets</span>
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {BACKGROUND_PRESETS.map((preset) => {
                    const isSelected = deviceSettings.backgroundBlur === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setDeviceSettings((prev) => ({ ...prev, backgroundBlur: preset.id }))
                        }
                        title={preset.name}
                        className={`relative aspect-square rounded-2xl overflow-hidden border-2 transition-all flex items-center justify-center ${
                          isSelected
                            ? 'border-blue-600 ring-2 ring-blue-300 scale-105 shadow-md shadow-blue-200'
                            : 'border-slate-200 hover:border-blue-300 opacity-80 hover:opacity-100 bg-slate-100'
                        }`}
                      >
                        {preset.thumbnail ? (
                          <img src={preset.thumbnail} alt={preset.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-600">
                            {preset.icon}
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        <div className="absolute bottom-1 right-1 p-0.5 rounded-md bg-black/60 text-white backdrop-blur-xs">
                          {preset.icon}
                        </div>
                        {isSelected && (
                          <div className="absolute top-1 left-1 p-0.5 rounded-full bg-blue-600 text-white shadow-sm">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Stream Resolution */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">
                  Broadcast Stream Resolution
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(['720p', '1080p', '4k'] as const).map((res) => (
                    <button
                      key={res}
                      onClick={() =>
                        setDeviceSettings((prev) => ({ ...prev, resolution: res }))
                      }
                      className={`py-3 rounded-2xl text-xs font-bold uppercase transition-all border ${
                        deviceSettings.resolution === res
                          ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-200'
                          : 'bg-white text-slate-600 border-slate-200/80 hover:bg-slate-50'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'network' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 text-xs text-emerald-800 space-y-1 shadow-sm">
                <div className="flex items-center space-x-2 font-bold">
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  <span>Network Latency: 24ms (Ultra-Low)</span>
                </div>
                <p className="text-[11px] text-slate-600">
                  Connected to ArchRoom Cloud Edge Node — Frankfurt / US-East Direct Tunnel.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-white/80 border border-blue-100/80 text-xs space-y-2 shadow-sm">
                <div className="font-bold text-slate-900">ArchRoom Version</div>
                <p className="text-slate-500 font-mono text-[11px]">v3.12.0-spatial-glass</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-blue-100/60 flex justify-end">
          <button
            onClick={onClose}
            className="py-2.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-200 transition-all active:scale-95"
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
};
