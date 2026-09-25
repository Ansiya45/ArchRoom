import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { getMeetingSession, type MeetingSession } from '@/lib/meetingSession';
import { trpc } from '@/lib/trpc';
import { updateMediaStream } from '@/lib/mediaStream';
import type { BackgroundChoice, ChatMessage } from '@/types/meeting';
import type { TranscriptSegment } from '@/components/meeting/TranscriptModal';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function publicationTrack(participant: Participant, source: Track.Source) {
  return participant.getTrackPublication(source)?.track?.mediaStreamTrack;
}

function participantStream(participant: Participant, previous?: MediaStream) {
  const video = publicationTrack(participant, Track.Source.ScreenShare)
    || publicationTrack(participant, Track.Source.Camera);
  const audio = publicationTrack(participant, Track.Source.Microphone);
  return updateMediaStream(previous, video, audio);
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
  onCameraStateChange: (enabled: boolean) => void,
  sessionIdentity?: MeetingSession | null
) {
  const roomRef = useRef<Room | null>(null);
  const streamsRef = useRef(new Map<string, MediaStream>());
  const displayStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteBackgrounds, setRemoteBackgrounds] = useState<Record<string, BackgroundChoice>>({});
  const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, boolean>>({});
  const [remoteRaisedHands, setRemoteRaisedHands] = useState<Record<string, boolean>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptAccessAllowed, setTranscriptAccessAllowed] = useState(false);
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
    if (roomRef.current !== room) return;
    const streamsByIdentity = new Map<string, MediaStream>();
    const streamFor = (participant: Participant) => {
      const stream = participantStream(participant, streamsRef.current.get(participant.identity));
      streamsByIdentity.set(participant.identity, stream);
      return stream;
    };
    setLocalStream(streamFor(room.localParticipant));
    const localMicrophone = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (localMicrophone) micStateCallbackRef.current(!localMicrophone.isMuted);
    const localCamera = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (localCamera) cameraStateCallbackRef.current(!localCamera.isMuted);
    const localScreenTrack = publicationTrack(room.localParticipant, Track.Source.ScreenShare);
    displayStreamRef.current = localScreenTrack
      ? updateMediaStream(displayStreamRef.current ?? undefined, localScreenTrack)
      : null;
    setDisplayStream(displayStreamRef.current);

    const streams: Record<string, MediaStream> = {};
    const backgrounds: Record<string, BackgroundChoice> = {};
    const screenShares: Record<string, boolean> = {};
    const raisedHands: Record<string, boolean> = {};
    const muted: Record<string, boolean> = {};
    const cameras: Record<string, boolean> = {};
    room.remoteParticipants.forEach((participant) => {
      streams[participant.identity] = streamFor(participant);
      backgrounds[participant.identity] = backgroundOf(participant);
      screenShares[participant.identity] = Boolean(publicationTrack(participant, Track.Source.ScreenShare));
      raisedHands[participant.identity] = participant.attributes.handRaised === 'true';
      const microphone = participant.getTrackPublication(Track.Source.Microphone);
      muted[participant.identity] = !microphone || microphone.isMuted;
      const camera = participant.getTrackPublication(Track.Source.Camera);
      cameras[participant.identity] = Boolean(camera && !camera.isMuted && camera.track);
    });
    const host = room.localParticipant.attributes.role === 'host'
      ? room.localParticipant
      : [...room.remoteParticipants.values()].find((participant) => participant.attributes.role === 'host');
    setTranscriptAccessAllowed(host?.attributes.transcriptAccess === 'true');
    streamsRef.current = streamsByIdentity;
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
    if (!room) return;

    const updateCamera = async () => {
      if (cameraOn) {
        await room.localParticipant.setCameraEnabled(
          true,
          cameraDeviceId !== 'default' ? { deviceId: cameraDeviceId } : undefined,
        );
      } else {
        const cameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cameraPublication?.track) {
          // Unpublishing with stop=true releases the physical camera instead of
          // only muting its outgoing video track.
          await room.localParticipant.unpublishTrack(cameraPublication.track, true);
        }
      }
    };

    void updateCamera()
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
    if (!room || !cameraDeviceId || !cameraOn) return;
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
  }, [cameraDeviceId, cameraOn]);

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
      if (!participant) return;
      try {
        if (topic === 'meeting-transcript') {
          const data = JSON.parse(decoder.decode(payload)) as { id: string; text: string; sentAt: string };
          if (!data.id || !data.text) return;
          setTranscriptSegments((current) => current.some((line) => line.id === data.id) ? current : [...current, {
            id: data.id,
            speaker: participant.name || 'Participant',
            text: data.text.slice(0, 2000),
            timestamp: new Date(data.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
          return;
        }
        if (topic !== 'meeting-chat') return;
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
        const session = sessionIdentity === undefined ? getMeetingSession(meetingCode) : sessionIdentity;
        const credentials = await trpc.meetings.livekitToken.mutate({
          meetingCode,
          participantId: session?.participantId,
          occurrenceId: session?.occurrenceId,
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
      streamsRef.current.clear();
      displayStreamRef.current = null;
      setLocalStream(null);
      setDisplayStream(null);
      setRemoteStreams({});
      setRemoteBackgrounds({});
      setRemoteScreenShares({});
      setRemoteRaisedHands({});
      setChatMessages([]);
      setTranscriptSegments([]);
      setTranscriptAccessAllowed(false);
    };
  }, [enabled, meetingCode]);

  const startScreenShare = async () => {
    const room = roomRef.current;
    if (!room) throw new Error('LiveKit is not connected yet.');
    // Screen sharing publishes only display video. Microphone audio is managed
    // independently by the microphone button.
    await room.localParticipant.setScreenShareEnabled(true, { audio: false, video: true });
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

  const publishTranscript = (text: string) => {
    const room = roomRef.current;
    const cleanText = text.trim();
    if (!room || !cleanText) return;
    const data = { id: crypto.randomUUID(), text: cleanText.slice(0, 2000), sentAt: new Date().toISOString() };
    const encoded = encoder.encode(JSON.stringify(data));
    const payload = new Uint8Array(encoded.byteLength);
    payload.set(encoded);
    void room.localParticipant.publishData(payload, { reliable: true, topic: 'meeting-transcript' });
    setTranscriptSegments((current) => [...current, {
      id: data.id,
      speaker: `${room.localParticipant.name || 'You'} (You)`,
      text: data.text,
      timestamp: new Date(data.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
  };

  const setTranscriptAccess = async (allowed: boolean) => {
    const room = roomRef.current;
    if (!room || room.localParticipant.attributes.role !== 'host') return;
    await room.localParticipant.setAttributes({ transcriptAccess: String(allowed) });
    setTranscriptAccessAllowed(allowed);
    refreshMedia(room);
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
    transcriptSegments,
    transcriptAccessAllowed,
    publishTranscript,
    setTranscriptAccess,
    connectionError,
  };
}
