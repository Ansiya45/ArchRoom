import { useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import { getMeetingSession } from '@/lib/meetingSession';
import type { BackgroundChoice } from '@/types/meeting';
import type { ChatMessage } from '@/types/meeting';

function getCallUrl() {
  const apiUrl = import.meta.env.VITE_API_BASE_URL;
  if (apiUrl) return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/call`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/call`;
}

function getPeerConfiguration(): RTCConfiguration {
  const turnUrl = import.meta.env.VITE_TURN_URL?.trim();
  const turnUsername = import.meta.env.VITE_TURN_USERNAME?.trim();
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL?.trim();
  const iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl.split(',').map((url: string) => url.trim()).filter(Boolean),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return { iceServers, iceCandidatePoolSize: 10 };
}

export function useWebRtcMeeting(meetingCode: string, enabled: boolean, micOn: boolean, cameraOn: boolean, background: BackgroundChoice) {
  const socketRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [remoteBackgrounds, setRemoteBackgrounds] = useState<Record<string, BackgroundChoice>>({});
  const [remoteScreenShares, setRemoteScreenShares] = useState<Record<string, boolean>>({});
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const selfPeerIdRef = useRef<string | null>(null);
  const backgroundRef = useRef(background);
  backgroundRef.current = background;

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'background', background }));
    }
  }, [background]);

  const sendSocket = (message: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const stopScreenShare = () => {
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    peersRef.current.forEach((peer) => {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      if (sender) void sender.replaceTrack(cameraTrack);
    });
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    setDisplayStream(null);
    sendSocket({ type: 'screen-share', active: false });
  };

  const startScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
    const selected = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const displayTrack = selected.getVideoTracks()[0];
    if (!displayTrack) throw new Error('No screen was selected.');
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = selected;
    setDisplayStream(selected);
    peersRef.current.forEach((peer) => {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      if (sender) void sender.replaceTrack(displayTrack);
    });
    displayTrack.addEventListener('ended', stopScreenShare, { once: true });
    sendSocket({ type: 'screen-share', active: true });
  };

  const sendChatMessage = (text: string) => {
    const cleanText = text.trim();
    if (cleanText) sendSocket({ type: 'chat', text: cleanText });
  };

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = micOn; });
  }, [micOn]);

  useEffect(() => {
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = cameraOn; });
  }, [cameraOn]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();

    const send = (message: unknown) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const createPeer = (peerId: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      const peer = new RTCPeerConnection(getPeerConfiguration());
      const remoteStream = new MediaStream();
      peersRef.current.set(peerId, peer);
      const cameraStream = localStreamRef.current;
      cameraStream?.getAudioTracks().forEach((track) => peer.addTrack(track, cameraStream));
      const videoTrack = displayStreamRef.current?.getVideoTracks()[0] || cameraStream?.getVideoTracks()[0];
      if (videoTrack) peer.addTrack(videoTrack, displayStreamRef.current || cameraStream!);
      peer.onicecandidate = (event) => {
        if (event.candidate) send({ type: 'ice', target: peerId, payload: event.candidate });
      };
      peer.ontrack = (event) => {
        // Some browsers omit event.streams. Build one stable stream per peer so
        // separately negotiated audio and video tracks always reach the player.
        const incomingStream = event.streams[0];
        const tracks = incomingStream ? incomingStream.getTracks() : [event.track];
        tracks.forEach((track) => {
          if (!remoteStream.getTracks().some((current) => current.id === track.id)) {
            remoteStream.addTrack(track);
          }
        });
        setRemoteStreams((current) => ({ ...current, [peerId]: remoteStream }));
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') {
          peer.restartIce();
          return;
        }
        if (peer.connectionState === 'closed') {
          peer.close();
          peersRef.current.delete(peerId);
          setRemoteStreams((current) => {
            const next = { ...current };
            delete next[peerId];
            return next;
          });
        }
      };
      return peer;
    };

    const flushIce = async (peerId: string, peer: RTCPeerConnection) => {
      const candidates = pendingIce.get(peerId) || [];
      pendingIce.delete(peerId);
      for (const candidate of candidates) await peer.addIceCandidate(candidate).catch(() => undefined);
    };

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
        stream.getVideoTracks().forEach((track) => { track.enabled = cameraOn; });
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : 'Camera or microphone access failed');
      }

      if (cancelled) return;
      const socket = new WebSocket(getCallUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        const session = getMeetingSession(meetingCode);
        socket.send(JSON.stringify({
          type: 'join',
          meetingCode,
          token: getAuthToken(),
          participantId: session?.participantId,
          background: backgroundRef.current,
        }));
      };
      socket.onmessage = async (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'peers') {
          const peers = message.peers as Array<{ peerId: string; background: BackgroundChoice }>;
          selfPeerIdRef.current = message.selfId;
          setChatMessages((message.messages || []).map((item: ChatMessage) => ({
            ...item,
            senderId: item.senderId === message.selfId ? 'user-self' : item.senderId,
            timestamp: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })));
          setRemoteBackgrounds(Object.fromEntries(peers.map((peer) => [peer.peerId, peer.background])));
          setRemoteScreenShares(Object.fromEntries((message.peers || []).map((peer: { peerId: string; screenSharing?: boolean }) => [peer.peerId, Boolean(peer.screenSharing)])));
          for (const { peerId } of peers) {
            const peer = createPeer(peerId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            send({ type: 'offer', target: peerId, payload: offer });
          }
        } else if (message.type === 'offer') {
          const peer = createPeer(message.peerId);
          await peer.setRemoteDescription(message.payload);
          await flushIce(message.peerId, peer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          send({ type: 'answer', target: message.peerId, payload: answer });
        } else if (message.type === 'answer') {
          const peer = createPeer(message.peerId);
          await peer.setRemoteDescription(message.payload);
          await flushIce(message.peerId, peer);
        } else if (message.type === 'ice') {
          const peer = createPeer(message.peerId);
          if (peer.remoteDescription) await peer.addIceCandidate(message.payload).catch(() => undefined);
          else pendingIce.set(message.peerId, [...(pendingIce.get(message.peerId) || []), message.payload]);
        } else if (message.type === 'peer-left') {
          peersRef.current.get(message.peerId)?.close();
          peersRef.current.delete(message.peerId);
          setRemoteStreams((current) => {
            const next = { ...current };
            delete next[message.peerId];
            return next;
          });
          setRemoteBackgrounds((current) => {
            const next = { ...current };
            delete next[message.peerId];
            return next;
          });
          setRemoteScreenShares((current) => {
            const next = { ...current };
            delete next[message.peerId];
            return next;
          });
        } else if (message.type === 'peer-joined' || message.type === 'background') {
          setRemoteBackgrounds((current) => ({ ...current, [message.peerId]: message.background || 'none' }));
          if (message.type === 'peer-joined') {
            setRemoteScreenShares((current) => ({ ...current, [message.peerId]: Boolean(message.screenSharing) }));
          }
        } else if (message.type === 'screen-share') {
          setRemoteScreenShares((current) => ({ ...current, [message.peerId]: Boolean(message.active) }));
        } else if (message.type === 'chat') {
          const item = message.message as ChatMessage;
          setChatMessages((current) => [...current, {
            ...item,
            senderId: item.senderId === selfPeerIdRef.current ? 'user-self' : item.senderId,
            timestamp: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }]);
        } else if (message.type === 'error') {
          setConnectionError(String(message.message));
        }
      };
      socket.onerror = () => setConnectionError('Unable to connect to the meeting media server');
    };

    void start();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      displayStreamRef.current?.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStreams({});
      setRemoteBackgrounds({});
      setRemoteScreenShares({});
      setDisplayStream(null);
      setChatMessages([]);
    };
  }, [enabled, meetingCode]);

  return {
    localStream,
    remoteStreams,
    remoteBackgrounds,
    remoteScreenShares,
    displayStream,
    isScreenSharing: Boolean(displayStream),
    startScreenShare,
    stopScreenShare,
    chatMessages,
    sendChatMessage,
    connectionError,
  };
}
