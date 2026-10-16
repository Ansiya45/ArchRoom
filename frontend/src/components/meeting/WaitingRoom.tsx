'use client';

import React, { useCallback } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Sparkles,
  ShieldCheck,
  User,
  ArrowRight,
  Volume2,
  Check,
  Ban,
  Droplets,
  Building2,
  Sun,
  Palette,
} from 'lucide-react';
import { DeviceSettings, BackgroundChoice } from '@/types/meeting';
import { CameraVideo } from './CameraVideo';

interface WaitingRoomProps {
  meetingCode: string;
  meetingTitle: string;
  isMicOn: boolean;
  onToggleMic: () => void;
  isCameraOn: boolean;
  onToggleCamera: () => void;
  onJoin: () => void;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  deviceSettings: DeviceSettings;
  setDeviceSettings: React.Dispatch<React.SetStateAction<DeviceSettings>>;
  isJoining: boolean;
  accountEmail?: string;
  checkingSession: boolean;
  sessionError: string;
  onRetrySession: () => void;
  isHost: boolean;
  enableAiTranscription: boolean;
  onEnableAiTranscriptionChange: (enabled: boolean) => void;
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
    name: 'Zen Minimalist Studio',
    thumbnail: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&auto=format&fit=crop&q=80',
    icon: <Sparkles className="w-4 h-4" />,
  },
];

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  meetingCode,
  meetingTitle,
  isMicOn,
  onToggleMic,
  isCameraOn,
  onToggleCamera,
  onJoin,
  displayName,
  onDisplayNameChange,
  deviceSettings,
  setDeviceSettings,
  isJoining,
  accountEmail,
  checkingSession,
  sessionError,
  onRetrySession,
  isHost,
  enableAiTranscription,
  onEnableAiTranscriptionChange,
}) => {
  const activeBg = deviceSettings.backgroundBlur || 'blur';
  const handleCameraUnavailable = useCallback(() => {
    if (isCameraOn) onToggleCamera();
  }, [isCameraOn, onToggleCamera]);

  const handleSelectBg = (bgId: BackgroundChoice) => {
    if (!isCameraOn) onToggleCamera();
    setDeviceSettings((prev) => ({ ...prev, backgroundBlur: bgId }));
  };

  return (
    <div className="w-full h-screen max-h-screen overflow-hidden bg-[#080b1f] text-white flex flex-col justify-between p-3 sm:p-5 md:p-6 relative font-sans select-none">
      {/* Ambient background lighting */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-200/50 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sky-200/50 rounded-full blur-3xl pointer-events-none" />

      {/* Header Branding */}
      <header className="w-full max-w-6xl mx-auto flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-200 text-white">
            <Video className="w-5 h-5" />
          </div>

          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              YLAAM-MEET
            </h1>
            <p className="text-[11px] text-slate-300 font-mono">Meeting ID: {meetingCode}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          {checkingSession ? <span role="status">Checking your session...</span> : accountEmail ? (
            <span className="max-w-48 truncate text-xs font-semibold text-slate-200" title={accountEmail}>Signed in as {accountEmail}</span>
          ) : (
            <span className="text-xs font-semibold text-slate-300">Joining as guest</span>
          )}
        </div>
      </header>

      {/* Main Content Area - Scaled for Desktop Viewports */}
      <main className="w-full max-w-6xl mx-auto flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center z-10 py-2 sm:py-3 my-auto overflow-hidden">
        {/* Left Column: Video Feed & Background Selector */}
        <div className="lg:col-span-7 flex flex-col h-full max-h-full justify-center space-y-3">
          <div className="relative w-full aspect-video rounded-3xl bg-slate-900 border border-white/80 overflow-hidden shadow-2xl backdrop-blur-xl group max-h-[380px]">
            <CameraVideo isCameraOn={isCameraOn} activeBg={activeBg} cameraDeviceId={deviceSettings.cameraId} onCameraUnavailable={handleCameraUnavailable} />

            {/* Mic & Camera Controls Overlay */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-30">
              <div className="flex items-center space-x-2">
                <button
                  onClick={onToggleMic}
                  className={`p-2.5 rounded-2xl backdrop-blur-md border transition-all ${
                    isMicOn
                      ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-200'
                      : 'bg-red-500 text-white border-red-400 shadow-md shadow-red-200'
                  }`}
                  title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
                >
                  {isMicOn ? <Mic className="w-4 h-4 sm:w-5 sm:h-5" /> : <MicOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>

                <button
                  onClick={onToggleCamera}
                  className={`p-2.5 rounded-2xl backdrop-blur-md border transition-all ${
                    isCameraOn
                      ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-200'
                      : 'bg-red-500 text-white border-red-400 shadow-md shadow-red-200'
                  }`}
                  title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
                >
                  {isCameraOn ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>
              </div>

              {/* Audio Visualizer Level Meter */}
              {isMicOn && (
                <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-2xl bg-black/50 border border-white/20 backdrop-blur-md text-white text-xs">
                  <Volume2 className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                  <div className="flex items-end space-x-0.5 h-3">
                    <div className="w-1 bg-blue-400 rounded-full h-2 animate-bounce" />
                    <div className="w-1 bg-blue-400 rounded-full h-3 animate-bounce [animation-delay:0.1s]" />
                    <div className="w-1 bg-blue-400 rounded-full h-1.5 animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Virtual Background Symbols Selector (Collection of 5 options) */}
          <div className="p-3 rounded-2xl bg-[#12162f] border border-white/10 text-xs shadow-sm backdrop-blur-xl flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 text-white font-bold shrink-0">
              <div className="p-1.5 rounded-xl bg-blue-100 text-blue-600">
                <Palette className="w-4 h-4" />
              </div>
              <span className="hidden sm:inline">Background</span>
            </div>

            <div className="flex items-center space-x-2 overflow-x-auto py-0.5 pr-1 scrollbar-none">
              {BACKGROUND_PRESETS.map((preset) => {
                const isSelected = activeBg === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectBg(preset.id)}
                    title={preset.name}
                    className={`relative flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-300 scale-105 shadow-md shadow-blue-200'
                        : 'border-slate-200 hover:border-blue-300 opacity-80 hover:opacity-100 bg-slate-100'
                    }`}
                  >
                    {preset.thumbnail ? (
                      <img
                        src={preset.thumbnail}
                        alt={preset.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-600">
                        {preset.icon}
                      </div>
                    )}

                    {/* Overlay badge with background symbol icon */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded-md bg-black/60 text-white backdrop-blur-xs">
                      {preset.icon}
                    </div>

                    {isSelected && (
                      <div className="absolute top-0.5 left-0.5 p-0.5 rounded-full bg-blue-600 text-white shadow-sm">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Meeting Join Settings */}
        <div className="lg:col-span-5 self-center w-full bg-[#12162f] border border-white/10 p-4 sm:p-5 rounded-3xl backdrop-blur-2xl shadow-xl text-white flex flex-col gap-5">
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
              Ready to connect
            </span>
            <h2 className="text-lg sm:text-xl font-bold text-white leading-tight">
              {meetingTitle || 'Join Meeting'}
            </h2>
            <p className="text-xs text-slate-300">
              Confirm your display name before requesting entry. No account is required.
            </p>
          </div>

          {/* Name Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white flex items-center space-x-1.5">
              <User className="w-4 h-4 text-blue-600" />
              <span>Your Display Name</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="Enter your name"
              className="w-full py-2.5 px-3.5 rounded-2xl bg-[#080b1f] border border-white/10 text-white font-medium text-xs sm:text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 transition-all shadow-sm"
            />
          </div>

          {isHost && <div className="rounded-xl border border-violet-400/30 bg-[#1a1e3b] p-3 text-xs text-white">
            <label className="flex items-start gap-2 font-semibold"><input type="checkbox" checked={enableAiTranscription} onChange={event => onEnableAiTranscriptionChange(event.target.checked)} className="mt-0.5 accent-violet-600" />Enable AI transcription for this meeting</label>
            <p className="mt-2 leading-relaxed">Off by default. If enabled, meeting audio is processed by YLAAM Meet and OpenAI. Participants will see when transcription is active. Transcript text and summaries are saved to your Meeting History.</p>
          </div>}

          {sessionError && <p role="alert" className="text-sm text-red-600">{sessionError} <button onClick={onRetrySession} className="font-semibold underline">Try again</button></p>}
          {/* Join Call Action */}
          <button
            onClick={onJoin}
            disabled={checkingSession || !!sessionError || !displayName.trim() || isJoining}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center space-x-2 shadow-lg shadow-blue-200 transition-all active:scale-95"
          >
            <span>{checkingSession ? 'Checking session...' : isJoining ? 'Joining...' : 'Join Meeting Now'}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </main>
    </div>
  );
};

