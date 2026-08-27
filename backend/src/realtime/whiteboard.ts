import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { meetingParticipants, meetings, users } from '../db/schema.js';
import { verifyJwt } from '../utils/jwt.js';

type Client = {
  socket: WebSocket;
  key: string;
  name: string;
  isHost: boolean;
};

type Room = {
  clients: Set<Client>;
  editors: Set<string>;
  shared: boolean;
  snapshot: string | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function roomState(room: Room, recipient: Client) {
  return {
    type: 'state',
    shared: room.shared,
    snapshot: room.snapshot,
    selfId: recipient.key,
    isHost: recipient.isHost,
    canEdit: recipient.isHost || room.editors.has(recipient.key),
    participants: [...room.clients].map((client) => ({
      id: client.key,
      name: client.name,
      isHost: client.isHost,
      canEdit: client.isHost || room.editors.has(client.key),
    })),
  };
}

function broadcast(room: Room) {
  room.clients.forEach((client) => send(client.socket, roomState(room, client)));
}

async function identify(input: any) {
  const meetingCode = String(input.meetingCode || '').trim().toUpperCase();
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.meetingCode, meetingCode),
  });
  if (!meeting) return null;

  if (input.token) {
    try {
      const identity = verifyJwt(String(input.token));
      const participant = await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.meetingId, meeting.id),
          eq(meetingParticipants.userId, identity.sub),
          eq(meetingParticipants.admission, 'admitted'),
          isNull(meetingParticipants.leftAt)
        ),
      });
      if (!participant) return null;
      const user = await db.query.users.findFirst({ where: eq(users.id, identity.sub) });
      return {
        meetingCode,
        key: `user:${identity.sub}`,
        name: user?.fullName || identity.name || 'Participant',
        isHost: meeting.hostUserId === identity.sub,
      };
    } catch {
      return null;
    }
  }

  const participantId = String(input.participantId || '');
  const participant = await db.query.meetingParticipants.findFirst({
    where: and(
      eq(meetingParticipants.id, participantId),
      eq(meetingParticipants.meetingId, meeting.id),
      eq(meetingParticipants.admission, 'admitted'),
      isNull(meetingParticipants.leftAt)
    ),
  });
  if (!participant) return null;
  return {
    meetingCode,
    key: `guest:${participant.id}`,
    name: participant.guestName || 'Guest User',
    isHost: false,
  };
}

export function attachWhiteboardServer(server: Server) {
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/whiteboard') return;
    websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit('connection', ws));
  });

  websocketServer.on('connection', (socket) => {
    let currentRoom: Room | null = null;
    let currentClient: Client | null = null;

    socket.once('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'join') throw new Error('Join required');
        const identity = await identify(message);
        if (!identity) throw new Error('Invalid meeting participant');

        currentRoom = rooms.get(identity.meetingCode) || {
          clients: new Set<Client>(),
          editors: new Set<string>(),
          shared: false,
          snapshot: null,
          closeTimer: null,
        };
        rooms.set(identity.meetingCode, currentRoom);
        currentClient = { socket, key: identity.key, name: identity.name, isHost: identity.isHost };
        currentRoom.clients.add(currentClient);
        broadcast(currentRoom);

        socket.on('message', (nextRaw) => {
          if (!currentRoom || !currentClient) return;
          try {
            const next = JSON.parse(nextRaw.toString());
            if (next.type === 'share' && currentClient.isHost) {
              if (next.shared && currentRoom.closeTimer) {
                clearTimeout(currentRoom.closeTimer);
                currentRoom.closeTimer = null;
              }
              currentRoom.shared = Boolean(next.shared);
              broadcast(currentRoom);
            } else if (next.type === 'close' && currentClient.isHost) {
              if (currentRoom.closeTimer) clearTimeout(currentRoom.closeTimer);
              const room = currentRoom;
              room.closeTimer = setTimeout(() => {
                room.closeTimer = null;
                room.shared = false;
                room.clients.forEach((client) => {
                  if (!client.isHost) send(client.socket, { type: 'close' });
                });
                broadcast(room);
              }, 5000);
            } else if (next.type === 'grant' && currentClient.isHost && typeof next.participantId === 'string') {
              if (next.canEdit) currentRoom.editors.add(next.participantId);
              else currentRoom.editors.delete(next.participantId);
              broadcast(currentRoom);
            } else if (
              next.type === 'snapshot' &&
              typeof next.data === 'string' &&
              next.data.startsWith('data:image/png;base64,') &&
              (currentClient.isHost || currentRoom.editors.has(currentClient.key))
            ) {
              currentRoom.snapshot = next.data;
              currentRoom.clients.forEach((client) => {
                if (client !== currentClient) send(client.socket, { type: 'snapshot', data: next.data });
              });
            }
          } catch {
            send(socket, { type: 'error', message: 'Invalid whiteboard message' });
          }
        });
      } catch {
        send(socket, { type: 'error', message: 'Unable to join shared whiteboard' });
        socket.close();
      }
    });

    socket.on('close', () => {
      if (!currentRoom || !currentClient) return;
      currentRoom.clients.delete(currentClient);
      if (currentRoom.clients.size === 0) {
        if (currentRoom.closeTimer) clearTimeout(currentRoom.closeTimer);
        for (const [code, room] of rooms) {
          if (room === currentRoom) rooms.delete(code);
        }
      } else {
        broadcast(currentRoom);
      }
    });
  });
}
