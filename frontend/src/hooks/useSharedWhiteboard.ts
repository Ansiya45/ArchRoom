import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import { getMeetingSession } from '@/lib/meetingSession';

export interface WhiteboardParticipant {
  id: string;
  name: string;
  isHost: boolean;
  canEdit: boolean;
}

function getWhiteboardUrl() {
  const apiUrl = import.meta.env.VITE_API_BASE_URL;
  if (apiUrl) return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/whiteboard`;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/whiteboard`;
}

export function useSharedWhiteboard(meetingCode: string, enabled: boolean) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [shared, setShared] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [participants, setParticipants] = useState<WhiteboardParticipant[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [closeSignal, setCloseSignal] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const session = getMeetingSession(meetingCode);
    const socket = new WebSocket(getWhiteboardUrl());
    socketRef.current = socket;
    setConnectionError(null);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'join',
        meetingCode,
        token: getAuthToken(),
        participantId: session?.participantId,
      }));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'state') {
        setConnected(true);
        setConnectionError(null);
        setShared(Boolean(message.shared));
        setIsHost(Boolean(message.isHost));
        setCanEdit(Boolean(message.canEdit));
        setParticipants(Array.isArray(message.participants) ? message.participants : []);
        if (typeof message.snapshot === 'string') setSnapshot(message.snapshot);
      } else if (message.type === 'snapshot' && typeof message.data === 'string') {
        setSnapshot(message.data);
      } else if (message.type === 'close') {
        setShared(false);
        setCloseSignal((value) => value + 1);
      } else if (message.type === 'error') {
        setConnectionError(String(message.message || 'Whiteboard connection rejected'));
      }
    };
    socket.onerror = () => setConnectionError('Cannot connect to the whiteboard backend.');
    socket.onclose = () => {
      setConnected(false);
      setConnectionError((current) => current || 'Whiteboard backend disconnected.');
    };

    return () => {
      socket.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [enabled, meetingCode]);

  const send = useCallback((message: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  return {
    connected,
    connectionError,
    shared,
    isHost,
    canEdit,
    participants,
    snapshot,
    closeSignal,
    setShared: (value: boolean) => send({ type: 'share', shared: value }),
    closeShared: () => send({ type: 'close', delayMs: 5000 }),
    grantAccess: (participantId: string, value: boolean) =>
      send({ type: 'grant', participantId, canEdit: value }),
    publishSnapshot: (data: string) => send({ type: 'snapshot', data }),
  };
}
