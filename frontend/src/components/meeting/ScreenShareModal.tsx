'use client';

import React, { useState } from 'react';
import {
  X,
  Check,
  Globe,
  AppWindow,
  Monitor,
  Volume2,
  VolumeX,
  FileText,
  Figma as FigmaIcon,
  Code2,
  FileCode,
  MessageSquare,
  Music,
  Terminal,
  LayoutGrid,
  Play,
  Pause,
  SkipForward,
  Maximize2,
  Folder,
  Layers,
  ZoomIn,
  Search,
} from 'lucide-react';

export type ScreenShareType = 'tab' | 'window' | 'screen';

export interface ScreenShareItem {
  id: string;
  type: ScreenShareType;
  title: string;
  icon: React.ReactNode;
  previewType:
    | 'meeting'
    | 'pdf'
    | 'figma'
    | 'docs'
    | 'analytics'
    | 'code'
    | 'slack'
    | 'spotify'
    | 'terminal'
    | 'desktop-1'
    | 'desktop-2';
}

interface ScreenShareModalProps {
  onStartShare: (item: ScreenShareItem, shareAudio: boolean) => void;
  onClose: () => void;
}

const BROWSER_TABS: ScreenShareItem[] = [
  {
    id: 'tab-archroom',
    type: 'tab',
    title: 'ARCHROOM Meeting',
    icon: <Globe className="w-4 h-4 text-blue-500" />,
    previewType: 'meeting',
  },
  {
    id: 'tab-drive-pdf',
    type: 'tab',
    title: 'ArchRoom_Facade_v4.2.pdf',
    icon: <FileText className="w-4 h-4 text-red-500" />,
    previewType: 'pdf',
  },
  {
    id: 'tab-figma',
    type: 'tab',
    title: 'Figma - Floorplan & 3D Render',
    icon: <FigmaIcon className="w-4 h-4 text-purple-500" />,
    previewType: 'figma',
  },
  {
    id: 'tab-docs-agenda',
    type: 'tab',
    title: 'Google Docs - Meeting Agenda',
    icon: <FileCode className="w-4 h-4 text-blue-600" />,
    previewType: 'docs',
  },
  {
    id: 'tab-analytics',
    type: 'tab',
    title: 'Studio Analytics Dashboard',
    icon: <LayoutGrid className="w-4 h-4 text-emerald-500" />,
    previewType: 'analytics',
  },
];

const WINDOWS: ScreenShareItem[] = [
  {
    id: 'win-vscode',
    type: 'window',
    title: 'Visual Studio Code',
    icon: <Code2 className="w-4 h-4 text-sky-400" />,
    previewType: 'code',
  },
  {
    id: 'win-slack',
    type: 'window',
    title: 'Slack - #architecture-team',
    icon: <MessageSquare className="w-4 h-4 text-amber-500" />,
    previewType: 'slack',
  },
  {
    id: 'win-adobe',
    type: 'window',
    title: 'Adobe Acrobat Reader',
    icon: <FileText className="w-4 h-4 text-red-400" />,
    previewType: 'pdf',
  },
  {
    id: 'win-spotify',
    type: 'window',
    title: 'Spotify Player',
    icon: <Music className="w-4 h-4 text-emerald-400" />,
    previewType: 'spotify',
  },
  {
    id: 'win-terminal',
    type: 'window',
    title: 'Terminal - zsh',
    icon: <Terminal className="w-4 h-4 text-slate-300" />,
    previewType: 'terminal',
  },
];

const SCREENS: ScreenShareItem[] = [
  {
    id: 'screen-primary',
    type: 'screen',
    title: 'Entire Screen 1',
    icon: <Monitor className="w-4 h-4 text-blue-400" />,
    previewType: 'desktop-1',
  },
  {
    id: 'screen-secondary',
    type: 'screen',
    title: 'Entire Screen 2',
    icon: <Monitor className="w-4 h-4 text-indigo-400" />,
    previewType: 'desktop-2',
  },
];

// Helper component to render realistic UI mockups for each selected screen
const PreviewScreenDisplay: React.FC<{ item: ScreenShareItem }> = ({ item }) => {
  switch (item.previewType) {
    case 'meeting':
      return (
        <div className="w-full h-full bg-slate-900 rounded-xl overflow-hidden flex flex-col p-2 justify-between border border-white/10">
          <div className="flex items-center justify-between text-[11px] text-slate-300 px-2 py-1 bg-slate-800/80 rounded-lg">
            <span className="flex items-center space-x-1.5 font-bold text-blue-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>ARCHROOM Call</span>
            </span>
            <span className="text-[10px] text-slate-400">00:24:12</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 my-2 flex-1">
            <div className="bg-slate-800 rounded-lg overflow-hidden relative border border-slate-700/50">
              <img
                src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&auto=format&fit=crop&q=80"
                alt="Meeting room"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-white">
                Sophia Chen
              </span>
            </div>
            <div className="bg-slate-800 rounded-lg overflow-hidden relative border border-slate-700/50">
              <img
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80"
                alt="Caller"
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-white">
                You (Presenter)
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center space-x-2 py-1 bg-slate-800/60 rounded-lg">
            <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-[8px] text-white">
              🎤
            </div>
            <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-[8px] text-white">
              📹
            </div>
            <div className="w-4 h-4 rounded-full bg-red-600 flex items-center justify-center text-[8px] text-white">
              📞
            </div>
          </div>
        </div>
      );

    case 'pdf':
      return (
        <div className="w-full h-full bg-slate-800 rounded-xl overflow-hidden flex flex-col border border-white/10 text-slate-200">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-700 text-[11px]">
            <div className="flex items-center space-x-2">
              <FileText className="w-3.5 h-3.5 text-red-400" />
              <span className="font-semibold text-slate-200 truncate max-w-[180px]">
                {item.title}
              </span>
            </div>
            <div className="flex items-center space-x-2 text-[10px] text-slate-400">
              <ZoomIn className="w-3 h-3" />
              <span>100%</span>
              <span>Page 1 / 12</span>
            </div>
          </div>
          <div className="flex-1 bg-slate-700/50 p-3 overflow-hidden flex items-center justify-center">
            <div className="w-3/4 h-full bg-white text-slate-900 rounded shadow-lg p-3 space-y-2 text-[8px] flex flex-col justify-between">
              <div className="border-b pb-1 font-bold text-slate-800 text-[10px] flex justify-between">
                <span>ARCHITECTURAL SPECIFICATIONS</span>
                <span className="text-blue-600">v4.2</span>
              </div>
              <div className="w-full h-20 bg-slate-100 rounded border border-slate-200 overflow-hidden relative">
                <img
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&auto=format&fit=crop&q=80"
                  alt="Blueprint"
                  className="w-full h-full object-cover opacity-80"
                />
              </div>
              <div className="space-y-1">
                <div className="w-full h-1.5 bg-slate-200 rounded" />
                <div className="w-4/5 h-1.5 bg-slate-200 rounded" />
                <div className="w-2/3 h-1.5 bg-slate-200 rounded" />
              </div>
            </div>
          </div>
        </div>
      );

    case 'figma':
      return (
        <div className="w-full h-full bg-slate-900 rounded-xl overflow-hidden flex flex-col border border-white/10">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-[11px]">
            <div className="flex items-center space-x-2">
              <FigmaIcon className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-semibold text-slate-200">Figma Canvas</span>
            </div>
            <span className="text-[10px] text-purple-400 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-500/30">
              Vector Editor
            </span>
          </div>
          <div className="flex-1 flex overflow-hidden">
            <div className="w-16 bg-slate-950 border-r border-slate-800 p-1.5 space-y-2 text-slate-400 text-[9px]">
              <div className="flex items-center space-x-1 font-bold text-slate-300">
                <Layers className="w-3 h-3 text-purple-400" />
                <span>Layers</span>
              </div>
              <div className="space-y-1 text-slate-400">
                <p className="bg-slate-800 px-1 py-0.5 rounded text-white">Frame 1</p>
                <p className="px-1">Header</p>
                <p className="px-1">3D Mesh</p>
              </div>
            </div>
            <div className="flex-1 bg-slate-900 p-3 flex items-center justify-center relative bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:12px_12px]">
              <div className="w-40 h-28 bg-white/90 rounded-lg border-2 border-purple-500 p-2 shadow-xl text-slate-800 text-[9px] relative">
                <span className="absolute -top-2.5 left-2 bg-purple-600 text-white px-1.5 py-0.2 rounded text-[8px] font-bold">
                  Facade Render
                </span>
                <div className="w-full h-16 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded mt-1 flex items-center justify-center text-white font-bold">
                  3D View
                </div>
              </div>
            </div>
          </div>
        </div>
      );

    case 'slack':
      return (
        <div className="w-full h-full bg-[#1a1d21] rounded-xl overflow-hidden flex flex-col border border-white/10 text-slate-200">
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-[#121519] border-b border-slate-800 text-[11px] font-bold">
            <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
            <span>#architecture-team — Slack</span>
          </div>
          <div className="flex-1 p-2.5 space-y-2 overflow-hidden text-[10px]">
            <div className="flex items-start space-x-2">
              <div className="w-5 h-5 rounded-md bg-purple-600 text-white font-bold flex items-center justify-center text-[9px]">
                SC
              </div>
              <div>
                <p className="font-bold text-slate-200">
                  Sophia Chen <span className="text-[8px] text-slate-500 font-normal">10:42 AM</span>
                </p>
                <p className="text-slate-300">Just uploaded the latest facade renders for review!</p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <div className="w-5 h-5 rounded-md bg-blue-600 text-white font-bold flex items-center justify-center text-[9px]">
                ME
              </div>
              <div>
                <p className="font-bold text-slate-200">
                  You <span className="text-[8px] text-slate-500 font-normal">10:44 AM</span>
                </p>
                <p className="text-slate-300">Looks great. Sharing screen in the call now.</p>
              </div>
            </div>
          </div>
        </div>
      );

    case 'spotify':
      return (
        <div className="w-full h-full bg-slate-950 rounded-xl overflow-hidden flex flex-col border border-white/10 p-3 justify-between text-white">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-[11px]">
            <Music className="w-4 h-4" />
            <span>Spotify — Ambient Focus</span>
          </div>
          <div className="flex items-center space-x-3 my-auto bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
            <div className="w-12 h-12 rounded-lg bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              🎵
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">Deep Architecture Focus</p>
              <p className="text-[10px] text-slate-400 truncate">Lo-Fi & Ambient Studio</p>
              <div className="w-full bg-slate-800 h-1 rounded-full mt-2 relative">
                <div className="bg-emerald-400 h-1 rounded-full w-2/3" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center space-x-4 text-slate-300">
            <Pause className="w-4 h-4 text-emerald-400" />
            <SkipForward className="w-4 h-4" />
          </div>
        </div>
      );

    case 'terminal':
      return (
        <div className="w-full h-full bg-black rounded-xl overflow-hidden flex flex-col border border-white/10 font-mono text-[10px] text-emerald-400 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1 mb-1 font-sans">
            <span className="flex items-center space-x-1">
              <Terminal className="w-3 h-3 text-slate-300" />
              <span>zsh — Terminal</span>
            </span>
            <span>node v20.11</span>
          </div>
          <p className="text-slate-400">$ npm run dev</p>
          <p className="text-emerald-400">VITE v5.2.0 ready in 240 ms</p>
          <p className="text-slate-300">➜ Local: http://localhost:3000/</p>
          <p className="text-slate-500">[vite] hmr update /src/components/meeting/MeetingRoom.tsx</p>
          <div className="flex items-center space-x-1 text-emerald-400">
            <span>$</span>
            <span className="w-1.5 h-3 bg-emerald-400 animate-pulse" />
          </div>
        </div>
      );

    case 'desktop-1':
      return (
        <div className="w-full h-full bg-gradient-to-br from-indigo-900 via-slate-900 to-blue-950 rounded-xl overflow-hidden flex flex-col justify-between p-2.5 border border-white/20 relative shadow-inner">
          <div className="flex items-center justify-between text-[10px] text-white/80 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md">
            <span>Display 1 (2560x1440)</span>
            <span>Finder • Safari • Code</span>
          </div>
          <div className="grid grid-cols-3 gap-2 my-auto p-2">
            <div className="bg-white/10 backdrop-blur-md p-2 rounded-lg border border-white/20 text-center text-white text-[9px] space-y-1">
              <Folder className="w-5 h-5 mx-auto text-blue-300" />
              <p className="truncate">Blueprints</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-2 rounded-lg border border-white/20 text-center text-white text-[9px] space-y-1">
              <Globe className="w-5 h-5 mx-auto text-emerald-300" />
              <p className="truncate">Browser</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-2 rounded-lg border border-white/20 text-center text-white text-[9px] space-y-1">
              <Code2 className="w-5 h-5 mx-auto text-purple-300" />
              <p className="truncate">VS Code</p>
            </div>
          </div>
          <div className="h-6 bg-black/60 backdrop-blur-md rounded-lg flex items-center justify-between px-3 text-[10px] text-slate-300">
            <span className="font-bold text-white">⌘ Desktop 1</span>
            <span className="text-[9px]">100% Battery</span>
          </div>
        </div>
      );

    case 'desktop-2':
      return (
        <div className="w-full h-full bg-gradient-to-br from-purple-900 via-slate-900 to-slate-950 rounded-xl overflow-hidden flex flex-col justify-between p-2.5 border border-white/20 relative">
          <div className="flex items-center justify-between text-[10px] text-white/80 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md">
            <span>Display 2 (4K Extended)</span>
            <span>Studio Monitor</span>
          </div>
          <div className="bg-slate-900/90 rounded-lg p-3 my-auto border border-slate-700/60 text-center space-y-1">
            <Monitor className="w-6 h-6 text-indigo-400 mx-auto" />
            <p className="text-xs font-bold text-white">Full Screen Display 2</p>
            <p className="text-[10px] text-slate-400">Extended Workstation View</p>
          </div>
          <div className="h-6 bg-black/60 backdrop-blur-md rounded-lg flex items-center justify-between px-3 text-[10px] text-slate-300">
            <span className="font-bold text-white">⌘ Desktop 2</span>
            <span className="text-[9px]">External Monitor</span>
          </div>
        </div>
      );

    default:
      return null;
  }
};

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  onStartShare,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ScreenShareType>('tab');
  const [selectedItem, setSelectedItem] = useState<ScreenShareItem>(BROWSER_TABS[0]);
  const [shareAudio, setShareAudio] = useState<boolean>(true);

  // Switch tab list and auto select first item
  const handleTabChange = (tab: ScreenShareType) => {
    setActiveTab(tab);
    if (tab === 'tab') setSelectedItem(BROWSER_TABS[0]);
    if (tab === 'window') setSelectedItem(WINDOWS[0]);
    if (tab === 'screen') setSelectedItem(SCREENS[0]);
  };

  const getActiveList = () => {
    if (activeTab === 'tab') return BROWSER_TABS;
    if (activeTab === 'window') return WINDOWS;
    return SCREENS;
  };

  const handleShareClick = () => {
    onStartShare(selectedItem, shareAudio);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-fadeIn select-none">
      <div className="w-full max-w-4xl bg-white/95 border border-white/80 rounded-3xl text-slate-800 shadow-2xl flex flex-col overflow-hidden backdrop-blur-2xl max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200/80 flex items-center justify-between bg-gradient-to-r from-slate-50 via-white to-blue-50/40">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-200">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Choose what to share with ARCHROOM
              </h2>
              <p className="text-xs text-slate-500">
                Select a tab, window, or screen to preview and present to all attendees.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Category Tabs */}
        <div className="flex items-center space-x-2 px-4 sm:px-6 pt-3 bg-slate-50/80 border-b border-slate-200/80 text-xs sm:text-sm font-semibold">
          <button
            onClick={() => handleTabChange('tab')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-2xl border-t border-x transition-all ${
              activeTab === 'tab'
                ? 'bg-white border-slate-200/80 text-blue-600 font-bold shadow-sm -mb-px'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/50'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Chrome Tab</span>
          </button>

          <button
            onClick={() => handleTabChange('window')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-2xl border-t border-x transition-all ${
              activeTab === 'window'
                ? 'bg-white border-slate-200/80 text-blue-600 font-bold shadow-sm -mb-px'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/50'
            }`}
          >
            <AppWindow className="w-4 h-4" />
            <span>Window</span>
          </button>

          <button
            onClick={() => handleTabChange('screen')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-2xl border-t border-x transition-all ${
              activeTab === 'screen'
                ? 'bg-white border-slate-200/80 text-blue-600 font-bold shadow-sm -mb-px'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/50'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Entire Screen</span>
          </button>
        </div>

        {/* Modal Main Body: Items List (Left) + Screen Preview (Right) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-white">
          
          {/* Left Column: Clean List of Single Names (Google Meet Style) */}
          <div className="md:col-span-5 p-3 sm:p-4 overflow-y-auto border-r border-slate-200/80 space-y-1.5 max-h-[380px] md:max-h-full">
            {getActiveList().map((item) => {
              const isSelected = selectedItem.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`w-full text-left px-3.5 py-3 rounded-2xl border transition-all flex items-center justify-between group relative ${
                    isSelected
                      ? 'bg-blue-50/90 border-blue-500 text-blue-900 font-bold shadow-sm'
                      : 'bg-white hover:bg-slate-50 border-slate-200/80 text-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0 pr-2">
                    <div
                      className={`p-2 rounded-xl flex-shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                      }`}
                    >
                      {item.icon}
                    </div>
                    <span className="text-xs sm:text-sm truncate">
                      {item.title}
                    </span>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Column: Live Screen Content Display */}
          <div className="md:col-span-7 p-4 sm:p-5 bg-slate-950 text-white flex flex-col justify-between overflow-hidden relative">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 z-10">
              <span className="text-xs font-semibold text-slate-300 truncate max-w-[280px]">
                Previewing: <span className="text-blue-400 font-bold">{selectedItem.title}</span>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[10px] font-mono">
                1080p Stream
              </span>
            </div>

            {/* Screen Content Preview Pane */}
            <div className="my-auto py-3 h-56 sm:h-64">
              <PreviewScreenDisplay item={selectedItem} />
            </div>

            <p className="text-[11px] text-slate-400 text-center z-10">
              Click Share to broadcast this screen live to all meeting participants.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <label className="flex items-center space-x-2.5 text-xs text-slate-700 font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shareAudio}
              onChange={(e) => setShareAudio(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            />
            <span className="flex items-center space-x-1.5">
              {shareAudio ? (
                <Volume2 className="w-3.5 h-3.5 text-blue-600" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>
                {activeTab === 'tab' ? 'Share tab audio' : 'Share system audio'}
              </span>
            </span>
          </label>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleShareClick}
              className="px-6 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center space-x-2"
            >
              <Monitor className="w-4 h-4" />
              <span>Share</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
