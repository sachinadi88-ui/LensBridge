import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import {WebSocket, WebSocketServer} from 'ws';
import type {
  ClientSignalMessage,
  IceServerConfig,
  PeerRole,
  ServerSignalMessage,
} from './src/types/stream.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Unambiguous uppercase alphabet (omits 0, O, 1, I) for quick manual entry
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

interface RoomRecord {
  code: string;
  viewer: WebSocket | null;
  broadcaster: WebSocket | null;
  createdAt: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

interface ClientSession {
  ws: WebSocket;
  roomCode: string | null;
  role: PeerRole | null;
  isAlive: boolean;
}

const rooms = new Map<string, RoomRecord>();
const sessions = new Map<WebSocket, ClientSession>();

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function send(ws: WebSocket | null, payload: ServerSignalMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(payload));
}

function scheduleRoomCleanup(room: RoomRecord): void {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  if (!room.viewer && !room.broadcaster) {
    // Keep room code reserved briefly (30s) in case the desktop viewer refreshes
    room.cleanupTimer = setTimeout(() => {
      const current = rooms.get(room.code);
      if (current && !current.viewer && !current.broadcaster) {
        rooms.delete(room.code);
      }
    }, 30_000);
  }
}

function detachClientFromRoom(session: ClientSession): void {
  if (!session.roomCode || !session.role) {
    return;
  }
  const room = rooms.get(session.roomCode);
  if (room) {
    const departedRole = session.role;
    if (departedRole === 'viewer' && room.viewer === session.ws) {
      room.viewer = null;
      send(room.broadcaster, {type: 'peer:left', role: 'viewer'});
    } else if (
      departedRole === 'broadcaster' &&
      room.broadcaster === session.ws
    ) {
      room.broadcaster = null;
      send(room.viewer, {type: 'peer:left', role: 'broadcaster'});
    }
    scheduleRoomCleanup(room);
  }
  session.roomCode = null;
  session.role = null;
}

function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ROOM_CODE_REGEX.test(cleaned) ? cleaned : null;
}

function handleClientMessage(session: ClientSession, rawData: string): void {
  let msg: ClientSignalMessage;
  try {
    msg = JSON.parse(rawData) as ClientSignalMessage;
  } catch {
    send(session.ws, {type: 'room:error', message: 'Invalid signaling payload.'});
    return;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return;
  }

  switch (msg.type) {
    case 'ping': {
      send(session.ws, {type: 'pong'});
      return;
    }

    case 'create-room': {
      detachClientFromRoom(session);

      const preferred = normalizeRoomCode(msg.preferredCode);
      let room: RoomRecord | undefined;

      if (preferred) {
        const existing = rooms.get(preferred);
        if (existing) {
          if (existing.viewer && existing.viewer !== session.ws) {
            send(session.ws, {
              type: 'room:error',
              code: 'VIEWER_OCCUPIED',
              message: 'This room already has an active desktop viewer.',
            });
            return;
          }
          room = existing;
        } else {
          room = {
            code: preferred,
            viewer: null,
            broadcaster: null,
            createdAt: Date.now(),
            cleanupTimer: null,
          };
          rooms.set(preferred, room);
        }
      } else {
        const code = generateRoomCode();
        room = {
          code,
          viewer: null,
          broadcaster: null,
          createdAt: Date.now(),
          cleanupTimer: null,
        };
        rooms.set(code, room);
      }

      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }

      room.viewer = session.ws;
      session.roomCode = room.code;
      session.role = 'viewer';

      send(session.ws, {
        type: 'room:created',
        roomCode: room.code,
        hasViewer: true,
        hasBroadcaster: Boolean(room.broadcaster),
      });

      if (room.broadcaster) {
        send(room.broadcaster, {type: 'peer:joined', role: 'viewer'});
      }
      return;
    }

    case 'join-room': {
      const code = normalizeRoomCode(msg.roomCode);
      if (!code) {
        send(session.ws, {
          type: 'room:error',
          code: 'INVALID_CODE',
          message: 'Enter a valid 6-character room code.',
        });
        return;
      }

      if (msg.role !== 'viewer' && msg.role !== 'broadcaster') {
        send(session.ws, {type: 'room:error', message: 'Invalid peer role.'});
        return;
      }

      const room = rooms.get(code);
      if (!room) {
        send(session.ws, {
          type: 'room:error',
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found. Check the code shown on your desktop viewer.',
        });
        return;
      }

      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }

      if (msg.role === 'viewer') {
        if (room.viewer && room.viewer !== session.ws) {
          send(session.ws, {
            type: 'room:error',
            code: 'VIEWER_OCCUPIED',
            message: 'This room already has an active desktop viewer.',
          });
          return;
        }
        detachClientFromRoom(session);
        room.viewer = session.ws;
        session.roomCode = code;
        session.role = 'viewer';

        send(session.ws, {
          type: 'room:joined',
          roomCode: code,
          role: 'viewer',
          hasViewer: true,
          hasBroadcaster: Boolean(room.broadcaster),
        });
        if (room.broadcaster) {
          send(room.broadcaster, {type: 'peer:joined', role: 'viewer'});
        }
      } else {
        if (room.broadcaster && room.broadcaster !== session.ws) {
          send(session.ws, {
            type: 'room:error',
            code: 'BROADCASTER_OCCUPIED',
            message: 'Another mobile camera is already streaming in this room.',
          });
          return;
        }
        detachClientFromRoom(session);
        room.broadcaster = session.ws;
        session.roomCode = code;
        session.role = 'broadcaster';

        send(session.ws, {
          type: 'room:joined',
          roomCode: code,
          role: 'broadcaster',
          hasViewer: Boolean(room.viewer),
          hasBroadcaster: true,
        });
        if (room.viewer) {
          send(room.viewer, {type: 'peer:joined', role: 'broadcaster'});
        }
      }
      return;
    }

    case 'leave-room': {
      detachClientFromRoom(session);
      return;
    }

    case 'signal:offer': {
      if (!session.roomCode || session.role !== 'broadcaster') return;
      const room = rooms.get(session.roomCode);
      if (room?.viewer && msg.sdp && typeof msg.sdp.sdp === 'string') {
        send(room.viewer, {type: 'signal:offer', sdp: msg.sdp});
      }
      return;
    }

    case 'signal:answer': {
      if (!session.roomCode || session.role !== 'viewer') return;
      const room = rooms.get(session.roomCode);
      if (room?.broadcaster && msg.sdp && typeof msg.sdp.sdp === 'string') {
        send(room.broadcaster, {type: 'signal:answer', sdp: msg.sdp});
      }
      return;
    }

    case 'signal:ice': {
      if (!session.roomCode || !session.role || !msg.candidate) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;
      const target = session.role === 'broadcaster' ? room.viewer : room.broadcaster;
      send(target, {type: 'signal:ice', candidate: msg.candidate});
      return;
    }

    case 'stream:meta': {
      if (!session.roomCode || session.role !== 'broadcaster' || !msg.meta) {
        return;
      }
      const room = rooms.get(session.roomCode);
      if (room?.viewer) {
        send(room.viewer, {type: 'stream:meta', meta: msg.meta});
      }
      return;
    }

    case 'remote:command': {
      if (!session.roomCode || session.role !== 'viewer' || !msg.command) {
        return;
      }
      const room = rooms.get(session.roomCode);
      if (room?.broadcaster) {
        send(room.broadcaster, {type: 'remote:command', command: msg.command});
      }
      return;
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit: '32kb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, activeRooms: rooms.size, signaling: 'ws'});
  });

  app.get('/api/ice-servers', (_req, res) => {
    const iceServers: IceServerConfig[] = [
      {urls: 'stun:stun.l.google.com:19302'},
      {urls: 'stun:stun1.l.google.com:19302'},
      {urls: 'stun:stun2.l.google.com:19302'},
    ];

    if (process.env.TURN_URL) {
      const turnConfig: IceServerConfig = {
        urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (process.env.TURN_USERNAME) {
        turnConfig.username = process.env.TURN_USERNAME;
      }
      if (process.env.TURN_CREDENTIAL) {
        turnConfig.credential = process.env.TURN_CREDENTIAL;
      }
      iceServers.push(turnConfig);
    }

    res.json({iceServers});
  });

  app.get('/api/rooms/:code/status', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    if (!code) {
      res.status(400).json({exists: false, error: 'Invalid room code format.'});
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      res.json({exists: false, hasViewer: false, hasBroadcaster: false});
      return;
    }
    res.json({
      exists: true,
      hasViewer: Boolean(room.viewer),
      hasBroadcaster: Boolean(room.broadcaster),
    });
  });

  const server = http.createServer(app);

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024,
  });

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      ws,
      roomCode: null,
      role: null,
      isAlive: true,
    };
    sessions.set(ws, session);

    ws.on('pong', () => {
      session.isAlive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      handleClientMessage(session, data.toString('utf8'));
    });

    ws.on('close', () => {
      detachClientFromRoom(session);
      sessions.delete(ws);
    });

    ws.on('error', () => {
      detachClientFromRoom(session);
      sessions.delete(ws);
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const [ws, session] of sessions.entries()) {
      if (!session.isAlive) {
        detachClientFromRoom(session);
        sessions.delete(ws);
        ws.terminate();
        continue;
      }
      session.isAlive = false;
      ws.ping();
    }
  }, 20_000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  if (!IS_PROD) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LensBridge server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LensBridge server:', err);
  process.exit(1);
});
