import { Participant, ChatMessage, MeetingInfoData, Poll } from '../types/meeting';

export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function generateMeetingCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const getRandomPart = (length: number) =>
    Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${getRandomPart(3)}-${getRandomPart(4)}-${getRandomPart(3)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      return successful;
    }
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
}

export const DUMMY_PARTICIPANTS: Participant[] = [
  {
    id: 'user-self',
    name: 'Alex Rivera (You)',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
    role: 'host',
    isMuted: false,
    isCameraOn: true,
    isSpeaking: true,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'excellent',
    audioLevel: 65,
    designation: 'Lead Architect',
  },
  {
    id: 'user-2',
    name: 'Elena Rostova',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80',
    role: 'co-host',
    isMuted: false,
    isCameraOn: true,
    isSpeaking: false,
    isHandRaised: true,
    isPinned: true,
    isScreenSharing: false,
    connectionQuality: 'excellent',
    audioLevel: 15,
    designation: 'VP of Product',
  },
  {
    id: 'user-3',
    name: 'Marcus Vance',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    role: 'attendee',
    isMuted: true,
    isCameraOn: true,
    isSpeaking: false,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'good',
    audioLevel: 0,
    designation: 'Principal Structural Engineer',
  },
  {
    id: 'user-4',
    name: 'Sophia Chen',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
    role: 'attendee',
    isMuted: false,
    isCameraOn: true,
    isSpeaking: false,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'excellent',
    audioLevel: 40,
    designation: 'Interior Concept Designer',
  },
  {
    id: 'user-5',
    name: 'David Kim',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    role: 'attendee',
    isMuted: true,
    isCameraOn: false,
    isSpeaking: false,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'good',
    audioLevel: 0,
    designation: '3D Visualization Lead',
  },
  {
    id: 'user-6',
    name: 'Amara Okafor',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80',
    role: 'attendee',
    isMuted: false,
    isCameraOn: true,
    isSpeaking: false,
    isHandRaised: false,
    isPinned: false,
    isScreenSharing: false,
    connectionQuality: 'excellent',
    audioLevel: 20,
    designation: 'Sustainability Director',
  },
];

export const DUMMY_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    senderId: 'user-2',
    senderName: 'Elena Rostova',
    senderAvatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80',
    message: 'Welcome everyone! Marcus is going to present the Q3 Glass Facade Blueprint.',
    timestamp: '10:14 AM',
    isHost: true,
  },
  {
    id: 'msg-2',
    senderId: 'user-3',
    senderName: 'Marcus Vance',
    senderAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    message: "I've attached the latest BIM rendering PDF for review before we dive in.",
    timestamp: '10:15 AM',
    fileAttachment: {
      name: 'ArchRoom_Facade_v4.2.pdf',
      size: '14.2 MB',
      type: 'PDF',
    },
  },
  {
    id: 'msg-3',
    senderId: 'user-4',
    senderName: 'Sophia Chen',
    senderAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
    message: 'The cantilever lighting study looks impressive! Is the glass solar-coated?',
    timestamp: '10:16 AM',
  },
];

export const DUMMY_POLLS: Poll[] = [
  {
    id: 'poll-1',
    question: 'Which facade glazing option do we approve for Phase 2?',
    totalVotes: 14,
    hasVoted: false,
    options: [
      { id: 'opt-1', text: 'Triple Low-E Smart Electrochromic', votes: 8 },
      { id: 'opt-2', text: 'Double Argon Matte Ceramic Tint', votes: 4 },
      { id: 'opt-3', text: 'Photovoltaic Semi-Transparent Glass', votes: 2 },
    ],
  },
];

export const BACKGROUND_PRESETS = [
  {
    id: 'none' as const,
    name: 'Original Video',
    description: 'No background effect applied',
  },
  {
    id: 'blur' as const,
    name: 'Soft Studio Blur',
    description: 'Blurs your surroundings',
  },
  {
    id: 'office' as const,
    name: 'Architectural Office',
    thumbnail: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&auto=format&fit=crop&q=80',
    description: 'Modern glass architecture workspace',
  },
  {
    id: 'skyline' as const,
    name: 'Penthouse Skyline',
    thumbnail: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=300&auto=format&fit=crop&q=80',
    description: 'High-rise urban view',
  },
  {
    id: 'studio' as const,
    name: 'Zen Minimalist Studio',
    thumbnail: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&auto=format&fit=crop&q=80',
    description: 'Clean interior studio space',
  },
];

export const DEFAULT_MEETING_INFO: MeetingInfoData = {
  meetingId: 'arch-9284-xkp',
  title: 'ARCHROOM',
  passcode: '882910',
  dialInNumber: '+1 (800) 555-0199 ID: 928 410',
  inviteLink:
    typeof window !== 'undefined'
      ? `${window.location.origin}/meet/arch-9284-xkp`
      : 'https://archroom.app/meet/arch-9284-xkp',
  hostName: 'Alex Rivera',
  scheduledTime: 'Today • 10:00 AM - 11:30 AM EST',
};
