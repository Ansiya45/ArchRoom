import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetingParticipants, meetings, users } from '../db/schema.js';
import { verifyJwt } from '../utils/jwt.js';

type CallClient = {
  socket: WebSocket;
  peerId: string;
  meetingCode: string;
  background: BackgroundChoice;
  name: string;
  isHost: boolean;
  screenSharing: boolean;
};

type BackgroundChoice = 'none' | 'blur' | 'office' | 'skyline' | 'studio';
const BACKGROUNDS = new Set<BackgroundChoice>(['none', 'blur', 'office', 'skyline', 'studio']);

function validBackground(value: unknown): BackgroundChoice {
  return BACKGROUNDS.has(value as BackgroundChoice) ? value as BackgroundChoice : 'none';
}

const rooms = new Map<string, Map<string, CallClient>>();
const chatHistory = new Map<string, Array<Record<string, unknown>>>();

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function identify(input: any) {
  const meetingCode = String(input.meetingCode || '').trim().toUpperCase();
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.meetingCode, meetingCode),
  });
  if (!meeting) return null;

  let participant;
  if (input.token) {
    try {
      const identity = verifyJwt(String(input.token));
      participant = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id),
          eq(meetingParticipants.userId, identity.sub),
          eq(meetingParticipants.admission, 'admitted'),
          isNull(meetingParticipants.leftAt)
        ),
      });
    } catch {
      return null;
    }
  } else {
    participant = await db.query.meetingParticipants.findFirst({
      where: and(
        eq(meetingParticipants.id, String(input.participantId || '')),
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.admission, 'admitted'),
        isNull(meetingParticipants.leftAt)
      ),
    });
  }

  if (!participant) return null;
  const user = participant.userId
    ? await db.query.users.findFirst({ where: eq(users.id, participant.userId) })
    : null;
  return {
    meetingCode,
    peerId: participant.id,
    name: participant.guestName || user?.fullName || 'Participant',
    isHost: participant.role === 'host',
  };
}

export function attachCallServer(server: Server) {
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/call') return;
    websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit('connection', ws));
  });

  websocketServer.on('connection', (socket) => {
    let client: CallClient | null = null;

    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (!client) {
          if (message.type !== 'join') throw new Error('Join required');
          const identity = await identify(message);
          if (!identity) throw new Error('Not an admitted meeting participant');

          const room = rooms.get(identity.meetingCode) || new Map<string, CallClient>();
          const previous = room.get(identity.peerId);
          if (previous) previous.socket.close(4001, 'Connected from another session');
          client = { socket, ...identity, background: validBackground(message.background), screenSharing: false };
          room.set(client.peerId, client);
          rooms.set(client.meetingCode, room);

          send(socket, {
            type: 'peers',
            selfId: client.peerId,
            messages: chatHistory.get(client.meetingCode) || [],
            peers: [...room.values()]
              .filter((peer) => peer.peerId !== client!.peerId)
              .map((peer) => ({ peerId: peer.peerId, background: peer.background, screenSharing: peer.screenSharing })),
          });
          room.forEach((peer) => {
            if (peer.peerId !== client!.peerId) {
              send(peer.socket, { type: 'peer-joined', peerId: client!.peerId, background: client!.background, screenSharing: false });
            }
          });
          return;
        }

        if (message.type === 'background') {
          client.background = validBackground(message.background);
          rooms.get(client.meetingCode)?.forEach((peer) => {
            if (peer.peerId !== client!.peerId) {
              send(peer.socket, { type: 'background', peerId: client!.peerId, background: client!.background });
            }
          });
          return;
        }
        if (message.type === 'screen-share') {
          client.screenSharing = Boolean(message.active);
          rooms.get(client.meetingCode)?.forEach((peer) => {
            if (peer.peerId !== client!.peerId) {
              send(peer.socket, { type: 'screen-share', peerId: client!.peerId, active: client!.screenSharing });
            }
          });
          return;
        }
        if (message.type === 'chat') {
          const text = String(message.text || '').trim().slice(0, 4000);
          if (!text) return;
          const chatMessage = {
            id: crypto.randomUUID(),
            senderId: client.peerId,
            senderName: client.name,
            senderAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(client.name)}`,
            message: text,
            timestamp: new Date().toISOString(),
            isHost: client.isHost,
          };
          const history = [...(chatHistory.get(client.meetingCode) || []), chatMessage].slice(-200);
          chatHistory.set(client.meetingCode, history);
          rooms.get(client.meetingCode)?.forEach((peer) => send(peer.socket, { type: 'chat', message: chatMessage }));
          return;
        }
        if (!['offer', 'answer', 'ice'].includes(message.type)) return;
        const target = rooms.get(client.meetingCode)?.get(String(message.target));
        if (target) {
          send(target.socket, {
            type: message.type,
            peerId: client.peerId,
            payload: message.payload,
          });
        }
      } catch (error) {
        send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Invalid call message' });
      }
    });

    socket.on('close', () => {
      if (!client) return;
      const room = rooms.get(client.meetingCode);
      if (!room || room.get(client.peerId)?.socket !== socket) return;
      room.delete(client.peerId);
      room.forEach((peer) => send(peer.socket, { type: 'peer-left', peerId: client!.peerId }));
      if (room.size === 0) {
        rooms.delete(client.meetingCode);
        chatHistory.delete(client.meetingCode);
      }
    });
  });
}
