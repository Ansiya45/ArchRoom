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
  canTranscribe?: boolean;
  transcriptAccess?: 'all' | 'host';
  onTranscriptAccessChange?: (access: 'all' | 'host') => void;
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
  canTranscribe = true,
  transcriptAccess = 'all',
  onTranscriptAccessChange,
}) => {
  const activeBg = deviceSettings.backgroundBlur || 'blur';
  const handleCameraUnavailable = useCallback(() => {
    if (isCameraOn) onToggleCamera();
  }, [isCameraOn, onToggleCamera]);

  const handleSelectBg = (bgId: BackgroundChoice) => {
    setDeviceSettings((prev) => ({ ...prev, backgroundBlur: bgId }));
  };

  return (
    <div className="w-full h-screen overflow-y-auto bg-[#080b1f] text-white flex flex-col p-3 sm:p-5 md:p-6 relative font-sans select-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-blue-400">

      {/* Header Branding */}
      <header className="w-full max-w-6xl mx-auto flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 shrink-0 rounded-[8px] bg-blue-600 flex items-center justify-center text-white">
            <svg aria-hidden="true" className="w-1/2 h-1/2 fill-current" viewBox="0 0 24 24"><path d="M12 2L2 22h5l2.5-5h5l2.5 5h5L12 2zm0 6l2.8 5.6h-5.6L12 8z" /></svg>
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
      <main className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch z-10 py-6 sm:py-8 my-auto shrink-0">
        {/* Left Column: Video Feed & Background Selector */}
        <div className="lg:col-span-7 min-w-0 flex flex-col rounded-[8px] bg-[#12162f] border border-white/20 overflow-hidden">
          <div className="relative w-full aspect-video lg:aspect-auto lg:flex-1 min-h-[220px] sm:min-h-[300px] rounded-[8px] bg-[#080b1f] overflow-hidden group">
            <div className="absolute inset-0">
            <CameraVideo className="[&_.rounded-xl]:rounded-[8px]" cameraOffContent={<div className="flex flex-col items-center gap-3" role="img" aria-label="YLAAM Meet, camera is turned off"><div className="w-14 h-14 sm:w-16 sm:h-16 rounded-[8px] bg-blue-600 text-white flex items-center justify-center"><svg aria-hidden="true" className="w-1/2 h-1/2 fill-current" viewBox="0 0 24 24"><path d="M12 2L2 22h5l2.5-5h5l2.5 5h5L12 2zm0 6l2.8 5.6h-5.6L12 8z" /></svg></div><span className="text-lg sm:text-xl font-bold text-white">YLAAM-MEET</span></div>} isCameraOn={isCameraOn} activeBg={activeBg} cameraDeviceId={deviceSettings.cameraId} onCameraUnavailable={handleCameraUnavailable} />
            </div>

            {/* Mic & Camera Controls Overlay */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-30">
              <div className="flex items-center space-x-2">
                <button
                  onClick={onToggleMic}
                  className={`p-2.5 rounded-[8px] backdrop-blur-md border transition-all ${
                    isMicOn
                      ? 'bg-[#1a1e35] text-white border-white/10 hover:bg-[#252a45]'
                      : 'bg-blue-500/15 text-blue-200 border-blue-400/40 hover:bg-blue-500/25'
                  }`}
                  title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
                >
                  {isMicOn ? <Mic className="w-4 h-4 sm:w-5 sm:h-5" /> : <MicOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>

                <button
                  onClick={onToggleCamera}
                  className={`p-2.5 rounded-[8px] backdrop-blur-md border transition-all ${
                    isCameraOn
                      ? 'bg-[#1a1e35] text-white border-white/10 hover:bg-[#252a45]'
                      : 'bg-blue-500/15 text-blue-200 border-blue-400/40 hover:bg-blue-500/25'
                  }`}
                  title={isCameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
                >
                  {isCameraOn ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>
              </div>

              {/* Audio Visualizer Level Meter */}
              {isMicOn && (
                <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-[8px] bg-black/50 border border-white/20 backdrop-blur-md text-white text-xs">
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
          <div className="p-4 sm:p-5 border-t border-white/10 text-xs flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center space-x-2 text-white font-bold shrink-0">
              <div className="p-1.5 rounded-[8px] bg-blue-500/15 text-blue-300">
                <Palette className="w-4 h-4" />
              </div>
              <span className="hidden sm:inline">Background</span>
            </div>

            <div className="flex min-w-0 items-center space-x-2 overflow-x-auto py-1 px-1 scrollbar-none">
              {BACKGROUND_PRESETS.map((preset) => {
                const isSelected = activeBg === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectBg(preset.id)}
                    title={preset.name}
                    className={`relative flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-[8px] overflow-hidden border-2 transition-all shrink-0 ${
                      isSelected
                        ? 'border-blue-400 ring-1 ring-blue-400'
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
                    <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded-[8px] bg-black/60 text-white backdrop-blur-xs">
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
        <div className="lg:col-span-5 min-w-0 w-full bg-[#12162f] border border-white/20 p-4 sm:p-5 rounded-[8px] text-white flex flex-col gap-5">
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
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
              <User className="w-4 h-4 text-blue-300" />
              <span>Your Display Name</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="Enter your name"
              className="w-full py-2.5 px-3.5 rounded-[8px] bg-[#080b1f] border border-white/10 text-white font-medium text-xs sm:text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 transition-all placeholder:text-slate-400"
            />
          </div>

          {isHost && canTranscribe && <div className="rounded-xl border border-violet-400/30 bg-[#1a1e3b] p-3 text-xs text-white">
            <label className="flex items-start gap-2 font-semibold"><input type="checkbox" checked={enableAiTranscription} onChange={event => onEnableAiTranscriptionChange(event.target.checked)} className="mt-0.5 accent-violet-600" />Enable AI transcription for this meeting</label>
            <p className="mt-2 leading-relaxed text-slate-300">If enabled, meeting audio is processed by YLAAM Meet and OpenAI. Participants will see when transcription is active. Transcript text and summaries are saved to your Meeting History.</p>
            {enableAiTranscription && onTranscriptAccessChange && <label className="mt-3 block font-semibold">
              Transcript &amp; AI summary downloads
              <select value={transcriptAccess} onChange={event => onTranscriptAccessChange(event.target.value as 'all' | 'host')}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-[#0d1029] px-2.5 py-2 text-xs font-semibold text-white focus:border-violet-500 focus:outline-none">
                <option value="all">Available to all participants</option>
                <option value="host">Host only</option>
              </select>
            </label>}
          </div>}

          {sessionError && <p role="alert" className="text-sm text-red-600">{sessionError} <button onClick={onRetrySession} className="font-semibold underline">Try again</button></p>}
          {/* Join Call Action */}
          <button
            onClick={onJoin}
            disabled={checkingSession || !!sessionError || !displayName.trim() || isJoining}
            className="mt-auto w-full py-3 rounded-[8px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center space-x-2 transition-all active:scale-95"
          >
            <span>{checkingSession ? 'Checking session...' : isJoining ? 'Joining...' : 'Join Meeting Now'}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </main>
    </div>
  );
};

