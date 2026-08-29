import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { getMeetingSession } from '@/lib/meetingSession';
import { trpc } from '@/lib/trpc';
import type { BackgroundChoice, ChatMessage } from '@/types/meeting';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function publicationTrack(participant: Participant, source: Track.Source) {
  return participant.getTrackPublication(source)?.track?.mediaStreamTrack;
}

function participantStream(participant: Participant) {
  const stream = new MediaStream();
  const video = publicationTrack(participant, Track.Source.ScreenShare)
    || publicationTrack(participant, Track.Source.Camera);
  const audio = publicationTrack(participant, Track.Source.Microphone);
  if (video) stream.addTrack(video);
  if (audio) stream.addTrack(audio);
  return stream;
}

function backgroundOf(participant: Participant): BackgroundChoice {
  const value = participant.attributes.background;
  return ['none', 'blur', 'office', 'skyline', 'studio'].includes(value)
    ? value as BackgroundChoice
    : 'none';
}

export function useWebRtcMeeting(
  meetingCode: string,
  enabled: boolean,
  micOn: boolean,
  cameraOn: boolean,
  background: BackgroundChoice,
  handRaised: boolean,
  microphoneDeviceId: string,
  onMicrophoneStateChange: (enabled: boolean) => void,
  cameraDeviceId: string,
  onCameraStateChange: (enabled: boolean) => void
) {
  const roomRef = useRef<Room | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteBackgrounds, setRemoteBackgrounds] = useState<Record<string, BackgroundChoice>>({});
  const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, boolean>>({});
  const [remoteRaisedHands, setRemoteRaisedHands] = useState<Record<string, boolean>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [remoteMicMuted, setRemoteMicMuted] = useState<Record<string, boolean>>({});
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [remoteCameraOn, setRemoteCameraOn] = useState<Record<string, boolean>>({});
  const [cameraError, setCameraError] = useState<string | null>(null);
  const micStateCallbackRef = useRef(onMicrophoneStateChange);
  micStateCallbackRef.current = onMicrophoneStateChange;
  const cameraStateCallbackRef = useRef(onCameraStateChange);
  cameraStateCallbackRef.current = onCameraStateChange;

  const describeCameraError = (error: unknown) => {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'Camera access was denied. Allow camera permission in your browser settings, then try again.';
    if (error instanceof DOMException && error.name === 'NotFoundError') return 'No camera is available. Connect one and try again.';
    if (error instanceof DOMException && error.name === 'NotReadableError') return 'The camera is busy or unavailable to this browser.';
    return error instanceof Error ? error.message : 'Unable to use the camera.';
  };

  const describeMicrophoneError = (error: unknown) => {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'Microphone access was denied. Allow microphone permission in your browser settings, then try again.';
    if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone is available. Connect one and try again.';
    if (error instanceof DOMException && error.name === 'NotReadableError') return 'The microphone is busy or unavailable to this browser.';
    return error instanceof Error ? error.message : 'Unable to use the microphone.';
  };

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (active) {
          setAudioInputDevices(devices.filter((device) => device.kind === 'audioinput'));
          setVideoInputDevices(devices.filter((device) => device.kind === 'videoinput'));
        }
      } catch (error) {
        if (active) setMicrophoneError(describeMicrophoneError(error));
      }
    };
    void refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  const refreshMedia = (room: Room) => {
    setLocalStream(participantStream(room.localParticipant));
    const localMicrophone = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (localMicrophone) micStateCallbackRef.current(!localMicrophone.isMuted);
    const localCamera = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (localCamera) cameraStateCallbackRef.current(!localCamera.isMuted);
    const localScreenTrack = publicationTrack(room.localParticipant, Track.Source.ScreenShare);
    setDisplayStream(localScreenTrack ? new MediaStream([localScreenTrack]) : null);

    const streams: Record<string, MediaStream> = {};
    const backgrounds: Record<string, BackgroundChoice> = {};
    const screenShares: Record<string, boolean> = {};
    const raisedHands: Record<string, boolean> = {};
    const muted: Record<string, boolean> = {};
    const cameras: Record<string, boolean> = {};
    room.remoteParticipants.forEach((participant) => {
      streams[participant.identity] = participantStream(participant);
      backgrounds[participant.identity] = backgroundOf(participant);
      screenShares[participant.identity] = Boolean(publicationTrack(participant, Track.Source.ScreenShare));
      raisedHands[participant.identity] = participant.attributes.handRaised === 'true';
      const microphone = participant.getTrackPublication(Track.Source.Microphone);
      muted[participant.identity] = !microphone || microphone.isMuted;
      const camera = participant.getTrackPublication(Track.Source.Camera);
      cameras[participant.identity] = Boolean(camera && !camera.isMuted && camera.track);
    });
    setRemoteStreams(streams);
    setRemoteBackgrounds(backgrounds);
    setRemoteScreenShares(screenShares);
    setRemoteRaisedHands(raisedHands);
    setRemoteMicMuted(muted);
    setRemoteCameraOn(cameras);
  };

  useEffect(() => {
    const room = roomRef.current;
    if (room) void room.localParticipant.setMicrophoneEnabled(micOn, microphoneDeviceId !== 'default' ? { deviceId: microphoneDeviceId } : undefined)
      .then(() => {
        setMicrophoneError(null);
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        micStateCallbackRef.current(Boolean(publication && !publication.isMuted));
        refreshMedia(room);
      })
      .catch((error) => {
        setMicrophoneError(describeMicrophoneError(error));
        micStateCallbackRef.current(false);
      });
  }, [micOn]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !microphoneDeviceId) return;
    void room.switchActiveDevice('audioinput', microphoneDeviceId).then(() => {
      setMicrophoneError(null);
      refreshMedia(room);
    }).catch(async (error) => {
      setMicrophoneError(`${describeMicrophoneError(error)} Falling back to the default microphone.`);
      try {
        await room.switchActiveDevice('audioinput', 'default');
        refreshMedia(room);
      } catch {
        micStateCallbackRef.current(false);
      }
    });
  }, [microphoneDeviceId]);

  useEffect(() => {
    const room = roomRef.current;
    if (room) void room.localParticipant.setCameraEnabled(cameraOn, cameraDeviceId !== 'default' ? { deviceId: cameraDeviceId } : undefined)
      .then(() => {
        setCameraError(null);
        const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
        cameraStateCallbackRef.current(Boolean(publication && !publication.isMuted));
        refreshMedia(room);
      })
      .catch((error) => {
        setCameraError(describeCameraError(error));
        cameraStateCallbackRef.current(false);
      });
  }, [cameraOn]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !cameraDeviceId) return;
    void room.switchActiveDevice('videoinput', cameraDeviceId).then(() => {
      setCameraError(null);
      refreshMedia(room);
    }).catch(async (error) => {
      setCameraError(`${describeCameraError(error)} Falling back to the default camera.`);
      try {
        await room.switchActiveDevice('videoinput', 'default');
        refreshMedia(room);
      } catch {
        cameraStateCallbackRef.current(false);
      }
    });
  }, [cameraDeviceId]);

  useEffect(() => {
    const room = roomRef.current;
    if (room) {
      void room.localParticipant.setAttributes({ background })
        .then(() => refreshMedia(room))
        .catch(() => undefined);
    }
  }, [background]);

  useEffect(() => {
    const room = roomRef.current;
    if (room) {
      void room.localParticipant.setAttributes({ handRaised: String(handRaised) })
        .then(() => refreshMedia(room))
        .catch(() => undefined);
    }
  }, [handRaised]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setConnectionError(null);

    const refresh = () => refreshMedia(room);
    const mediaEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantAttributesChanged,
    ];
    mediaEvents.forEach((event) => room.on(event, refresh));

    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== 'meeting-chat' || !participant) return;
      try {
        const data = JSON.parse(decoder.decode(payload)) as {
          id: string;
          text: string;
          sentAt: string;
          fileAttachment?: ChatMessage['fileAttachment'];
        };
        setChatMessages((current) => [...current, {
          id: data.id,
          senderId: participant.identity,
          senderName: participant.name || 'Participant',
          senderAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(participant.name || participant.identity)}`,
          message: data.text,
          timestamp: new Date(data.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isHost: participant.attributes.role === 'host',
          fileAttachment: data.fileAttachment,
        }]);
      } catch {
        // Ignore malformed data packets from clients.
      }
    });

    const connect = async () => {
      try {
        const session = getMeetingSession(meetingCode);
        const credentials = await trpc.meetings.livekitToken.mutate({
          meetingCode,
          participantId: session?.participantId,
        });
        if (cancelled) return;
        await room.connect(credentials.url, credentials.token);
        if (cancelled) return;
        await room.localParticipant.setAttributes({ background, handRaised: String(handRaised) });
        const [microphoneResult, cameraResult] = await Promise.allSettled([
          room.localParticipant.setMicrophoneEnabled(micOn, microphoneDeviceId !== 'default' ? { deviceId: microphoneDeviceId } : undefined),
          room.localParticipant.setCameraEnabled(cameraOn, cameraDeviceId !== 'default' ? { deviceId: cameraDeviceId } : undefined),
        ]);
        if (microphoneResult.status === 'rejected') {
          setMicrophoneError(describeMicrophoneError(microphoneResult.reason));
          micStateCallbackRef.current(false);
        }
        if (cameraResult.status === 'rejected') {
          setCameraError(describeCameraError(cameraResult.reason));
          cameraStateCallbackRef.current(false);
        }
        refreshMedia(room);
      } catch (error) {
        if (!cancelled) {
          setConnectionError(error instanceof Error ? error.message : 'Unable to connect to LiveKit');
        }
      }
    };
    void connect();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
      setLocalStream(null);
      setDisplayStream(null);
      setRemoteStreams({});
      setRemoteBackgrounds({});
      setRemoteScreenShares({});
      setRemoteRaisedHands({});
      setChatMessages([]);
    };
  }, [enabled, meetingCode]);

  const startScreenShare = async () => {
    const room = roomRef.current;
    if (!room) throw new Error('LiveKit is not connected yet.');
    await room.localParticipant.setScreenShareEnabled(true, { audio: true, video: true });
    refreshMedia(room);
  };

  const stopScreenShare = () => {
    const room = roomRef.current;
    if (!room) return;
    void room.localParticipant.setScreenShareEnabled(false).then(() => refreshMedia(room));
  };

  const sendChatMessage = (text: string, fileAttachment?: ChatMessage['fileAttachment']) => {
    const room = roomRef.current;
    const cleanText = text.trim();
    if (!room || (!cleanText && !fileAttachment)) return;
    const data = {
      id: crypto.randomUUID(),
      text: cleanText.slice(0, 4000),
      sentAt: new Date().toISOString(),
      fileAttachment,
    };
    const encoded = encoder.encode(JSON.stringify(data));
    const payload = new Uint8Array(encoded.byteLength);
    payload.set(encoded);
    void room.localParticipant.publishData(payload, { reliable: true, topic: 'meeting-chat' });
    setChatMessages((current) => [...current, {
      id: data.id,
      senderId: 'user-self',
      senderName: `${room.localParticipant.name || 'You'} (You)`,
      senderAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(room.localParticipant.name || 'You')}`,
      message: data.text,
      timestamp: new Date(data.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHost: room.localParticipant.attributes.role === 'host',
      fileAttachment,
    }]);
  };

  return {
    localStream,
    remoteStreams,
    remoteBackgrounds,
    remoteScreenShares,
    remoteRaisedHands,
    remoteMicMuted,
    remoteCameraOn,
    audioInputDevices,
    videoInputDevices,
    microphoneError,
    cameraError,
    displayStream,
    isScreenSharing: Boolean(displayStream),
    startScreenShare,
    stopScreenShare,
    chatMessages,
    sendChatMessage,
    connectionError,
  };
}
