export type ParticipantRole = 'host' | 'co-host' | 'attendee';

export type ConnectionQuality = 'excellent' | 'good' | 'poor';

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  role: ParticipantRole;
  isMuted: boolean;
  isCameraOn: boolean;
  isSpeaking: boolean;
  isHandRaised: boolean;
  isPinned: boolean;
  isScreenSharing: boolean;
  sharedScreenTitle?: string;
  connectionQuality: ConnectionQuality;
  audioLevel: number; // 0 to 100 for live animation
  videoUrl?: string;
  designation?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  message: string;
  timestamp: string;
  isHost?: boolean;
  fileAttachment?: {
    name: string;
    size: string;
    type: string;
  };
}

export type SidebarTab = 'chat' | 'participants' | 'activities' | null;

export type LayoutMode = 'speaker' | 'grid';

export type BackgroundChoice = 'none' | 'blur' | 'office' | 'skyline' | 'studio';

export interface DeviceSettings {
  micId: string;
  cameraId: string;
  speakerId: string;
  noiseCancellation: boolean;
  backgroundBlur: BackgroundChoice;
  resolution: '720p' | '1080p' | '4k';
}

export interface MeetingInfoData {
  meetingId: string;
  title: string;
  passcode: string;
  dialInNumber: string;
  inviteLink: string;
  hostName: string;
  scheduledTime: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  hasVoted?: boolean;
}
