'use client';

import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Users,
  MessageSquare,
  MoreHorizontal,
  PhoneOff,
  MoreVertical,
  Volume2,
  Hand,
  CheckCircle2,
  Sparkles,
  X,
  Send,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from 'lucide-react';

export interface ActiveMeetingProps {
  currentMeeting?: {
    title: string;
    code: string;
    hostName: string;
    isLive: boolean;
  } | null;
  onLeaveMeeting?: () => void;
}

interface Participant {
  id: string;
  name: string;
  avatar: string;
  objectPosition?: string;
  isMuted: boolean;
  isSpeaking: boolean;
  hasHandRaised?: boolean;
}

export const MeetingCard: React.FC<ActiveMeetingProps> = ({
  currentMeeting,
  onLeaveMeeting,
}) => {
  // Active room info fallback
  const meetingTitle = currentMeeting?.title || 'Design Critique & UI Motion Specs';
  const meetingCode = currentMeeting?.code || 'arch-402-991';

  // State for interactive toolbar toggles
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);

  const [chatMessages, setChatMessages] = useState([
    { id: '1', sender: 'Sarah J.', text: 'Hey everyone! Ready for the sprint review?', time: '10:32 AM' },
    { id: '2', sender: 'Mike C.', text: 'Yes, I uploaded the design specs to Figma.', time: '10:33 AM' },
  ]);
  const [newMessage, setNewMessage] = useState('');

  // 4 Main Participants
  const [participants, setParticipants] = useState<Participant[]>([
    {
      id: 'you',
      name: 'You (Host)',
      avatar:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&crop=faces&w=800&q=80',
      objectPosition: 'object-[center_20%]',
      isMuted: false,
      isSpeaking: true,
      hasHandRaised: false,
    },
    {
      id: 'sarah',
      name: 'Sarah J.',
      avatar:
        'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&crop=faces&w=800&q=80',
      objectPosition: 'object-[center_15%]',
      isMuted: false,
      isSpeaking: true,
    },
    {
      id: 'mike',
      name: 'Mike C.',
      avatar:
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&crop=faces&w=800&q=80',
      objectPosition: 'object-[center_20%]',
      isMuted: false,
      isSpeaking: false,
    },
    {
      id: 'emma',
      name: 'Emma W.',
      avatar:
        'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&crop=faces&w=800&q=80',
      objectPosition: 'object-[center_20%]',
      isMuted: true,
      isSpeaking: false,
    },
  ]);

  // Update 'You' participant state based on controls
  useEffect(() => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === 'you'
          ? {
              ...p,
              isMuted: !micOn,
              isSpeaking: micOn,
              hasHandRaised: handRaised,
            }
          : p
      )
    );
  }, [micOn, handRaised]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(`https://archroom.app/meet/${meetingCode}`);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleParticipantMute = (id: string) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isMuted: !p.isMuted } : p))
    );
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const userMsg = {
      id: Date.now().toString(),
      sender: 'You',
      text: newMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setNewMessage('');

    // Simulated Smart Reply after 1.5 seconds
    setTimeout(() => {
      const replies = [
        'Sarah J.: Sounding good! Let us check the specs.',
        'Mike C.: Thanks for the update! I agree.',
        'Emma W.: I have updated the shared doc as well.',
      ];
      const randomReply = replies[Math.floor(Math.random() * replies.length)];
      const [sender, ...rest] = randomReply.split(': ');
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender,
          text: rest.join(': '),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }, 1500);
  };

  const slides = [
    {
      title: 'Architectural Roadmap 2026',
      subtitle: 'Global HD streaming architecture, zero-latency room syncing and encrypted media channels.',
    },
    {
      title: 'Spatial Audio Engine',
      subtitle: 'Dynamic 3D directional positioning for seamless multi-speaker discussions.',
    },
    {
      title: 'End-to-End Encryption Specs',
      subtitle: 'WebRTC DTLS/SRTP hardware security layers with key isolation.',
    },
  ];

  return (
    <div className="relative w-full max-w-lg lg:max-w-xl mx-auto rounded-2xl bg-white p-2.5 sm:p-3 shadow-xl shadow-blue-500/10 border border-slate-200/80 transition-all duration-300 hover:shadow-blue-500/15">
      {/* Screen Sharing Banner */}
      {screenSharing && (
        <div className="mb-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-700 font-medium">
          <span className="flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
            You are sharing your presentation screen
          </span>
          <button
            onClick={() => setScreenSharing(false)}
            className="text-blue-600 hover:underline cursor-pointer text-xs font-bold"
          >
            Stop Sharing
          </button>
        </div>
      )}

      {/* 2x2 Video Tile Grid / Screen Share view */}
      <div className="relative w-full aspect-[16/10] bg-slate-900 rounded-xl overflow-hidden grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
        {screenSharing ? (
          /* Screen Sharing View Overlay with Interactive Slides */
          <div className="col-span-2 row-span-2 relative bg-slate-950 rounded-xl overflow-hidden flex flex-col items-center justify-center p-4 text-white border border-slate-800">
            <div className="w-full h-full bg-slate-900 rounded-lg p-4 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-xs text-slate-400 font-mono ml-1">archroom-deck-v2.pdf</span>
                </div>
                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded font-semibold">Presenting</span>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 space-y-2">
                <Sparkles className="w-8 h-8 text-blue-400 animate-bounce" />
                <h4 className="text-base font-bold text-slate-100">{slides[slideIndex].title}</h4>
                <p className="text-xs text-slate-400 max-w-sm">{slides[slideIndex].subtitle}</p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSlideIndex((prev) => (prev > 0 ? prev - 1 : slides.length - 1))}
                    className="p-1 bg-slate-800 hover:bg-slate-700 rounded-md cursor-pointer text-slate-300"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Slide {slideIndex + 1} of {slides.length}
                  </span>
                  <button
                    onClick={() => setSlideIndex((prev) => (prev < slides.length - 1 ? prev + 1 : 0))}
                    className="p-1 bg-slate-800 hover:bg-slate-700 rounded-md cursor-pointer text-slate-300"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className="text-[10px] text-emerald-400 font-medium">1080p 60fps</span>
              </div>
            </div>

            {/* Small floating webcam preview of 'You' */}
            <div className="absolute bottom-4 right-4 w-24 h-16 rounded-xl overflow-hidden border-2 border-blue-500 shadow-xl">
              <img src={participants[0].avatar} alt="You" className="w-full h-full object-cover" />
              <span className="absolute bottom-1 left-1 bg-black/70 px-1 py-0.5 text-[9px] text-white rounded">You</span>
            </div>
          </div>
        ) : (
          /* Normal 2x2 Participant Grid */
          participants.map((p) => {
            const isYou = p.id === 'you';
            const showCam = isYou ? videoOn : true;

            return (
              <div
                key={p.id}
                className="relative group rounded-xl overflow-hidden bg-slate-800 flex items-center justify-center border border-slate-700/50 shadow-inner"
              >
                {/* Video Image / Camera Off State */}
                {showCam ? (
                  <img
                    src={p.avatar}
                    alt={p.name}
                    className={`w-full h-full object-cover ${p.objectPosition || 'object-[center_20%]'} transition-transform duration-300 group-hover:scale-102`}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center space-y-2 text-slate-400">
                    <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 text-lg font-bold border-2 border-slate-600">
                      {p.name.charAt(0)}
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium">Camera Off</span>
                  </div>
                )}

                {/* Hand Raised Banner */}
                {p.hasHandRaised && (
                  <div className="absolute top-2 left-2 bg-amber-500 text-slate-950 font-bold text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 shadow-md animate-bounce">
                    <Hand className="w-3 h-3" />
                    <span>Raised Hand</span>
                  </div>
                )}

                {/* Audio pulse highlight border when speaking */}
                {p.isSpeaking && !p.isMuted && (
                  <div className="absolute inset-0 border-2 border-blue-500 rounded-xl pointer-events-none transition-all" />
                )}

                {/* Bottom-Left Name Badge & Mic Indicator */}
                <div className="absolute bottom-2 left-2 bg-slate-900/80 backdrop-blur-md text-white text-xs font-medium px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm border border-slate-700/50">
                  <span className="text-[11px] truncate">{p.name}</span>
                  {p.isMuted ? (
                    <MicOff className="w-3 h-3 text-red-400" />
                  ) : (
                    <Volume2 className="w-3 h-3 text-blue-400" />
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Floating Chat Overlay Panel */}
        {showChat && (
          <div className="absolute inset-y-2 right-2 w-72 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl flex flex-col justify-between shadow-2xl z-20 text-white animate-in slide-in-from-right duration-200">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-blue-400" /> In-Meeting Chat
              </span>
              <button
                onClick={() => setShowChat(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.sender === 'You' ? 'items-end' : 'items-start'
                  }`}
                >
                  <span className="text-[10px] text-slate-400 mb-0.5">{msg.sender} • {msg.time}</span>
                  <div
                    className={`p-2.5 rounded-xl max-w-[85%] ${
                      msg.sender === 'You'
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="p-2.5 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                placeholder="Send a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white p-1.5 rounded-lg flex items-center justify-center cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}

        {/* Floating Participants Drawer Overlay */}
        {showParticipants && (
          <div className="absolute inset-y-2 right-2 w-72 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl flex flex-col justify-between shadow-2xl z-20 text-white animate-in slide-in-from-right duration-200">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-400" /> Participants ({participants.length})
              </span>
              <button
                onClick={() => setShowParticipants(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 bg-slate-800/80 rounded-xl border border-slate-700/50">
                  <div className="flex items-center gap-2.5">
                    <img src={p.avatar} alt={p.name} className="w-8 h-8 rounded-full object-cover" />
                    <div>
                      <div className="text-xs font-semibold text-slate-100">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.id === 'you' ? 'Host' : 'Guest'}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleParticipantMute(p.id)}
                    title={p.isMuted ? 'Unmute participant' : 'Mute participant'}
                    className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  >
                    {p.isMuted ? (
                      <MicOff className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <Mic className="w-3.5 h-3.5 text-blue-400" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Toolbar Container */}
      <div className="mt-2 bg-slate-900/95 backdrop-blur-md rounded-xl px-2.5 sm:px-4 py-2 flex items-center justify-between border border-slate-800 shadow-lg text-white">
        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Microphone Toggle */}
          <button
            onClick={() => setMicOn(!micOn)}
            title={micOn ? 'Mute Microphone' : 'Unmute Microphone'}
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
              micOn
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {micOn ? <Mic className="w-4 h-4 text-slate-200" /> : <MicOff className="w-4 h-4" />}
          </button>

          {/* Camera Toggle */}
          <button
            onClick={() => setVideoOn(!videoOn)}
            title={videoOn ? 'Turn Off Camera' : 'Turn On Camera'}
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
              videoOn
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {videoOn ? <Video className="w-4 h-4 text-slate-200" /> : <VideoOff className="w-4 h-4" />}
          </button>

          {/* Screen Share Toggle */}
          <button
            onClick={() => setScreenSharing(!screenSharing)}
            title="Share Screen"
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
              screenSharing
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
          </button>

          {/* Raise Hand Toggle */}
          <button
            onClick={() => setHandRaised(!handRaised)}
            title="Raise Hand"
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer ${
              handRaised
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <Hand className="w-4 h-4" />
          </button>

          {/* Participants Toggle */}
          <button
            onClick={() => {
              setShowParticipants(!showParticipants);
              if (showChat) setShowChat(false);
            }}
            title="Participants"
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer relative ${
              showParticipants
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[9px] font-extrabold w-3.5 h-3.5 rounded-full flex items-center justify-center">
              {participants.length}
            </span>
          </button>

          {/* Chat Panel Toggle */}
          <button
            onClick={() => {
              setShowChat(!showChat);
              if (showParticipants) setShowParticipants(false);
            }}
            title="In-Meeting Chat"
            className={`p-2 rounded-lg transition-all duration-200 cursor-pointer relative ${
              showChat
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          </button>
        </div>

        {/* End Call Button */}
        <button
          onClick={() => {
            if (onLeaveMeeting) {
              onLeaveMeeting();
            } else {
              alert('Leaving ArchRoom Meeting Preview...');
            }
          }}
          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-red-500/25 active:scale-95 transition-all cursor-pointer"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">Leave</span>
        </button>
      </div>
    </div>
  );
};

export default MeetingCard;
