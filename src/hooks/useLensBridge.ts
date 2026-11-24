import Peer, {type DataConnection, type MediaConnection} from 'peerjs';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  CameraFacingMode,
  ClientSignalMessage,
  ConnectionStage,
  IceServerConfig,
  PeerRole,
  RemoteCommand,
  ServerSignalMessage,
  StreamMeta,
  StreamStats,
  VideoQualityPreset,
} from '../types/stream.ts';

const QUALITY_DIMENSIONS: Record<
  VideoQualityPreset,
  {width: number; height: number; fps: number}
> = {
  '480p': {width: 854, height: 480, fps: 30},
  '720p': {width: 1280, height: 720, fps: 30},
  '1080p': {width: 1920, height: 1080, fps: 30},
};

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  {urls: 'stun:stun.l.google.com:19302'},
  {urls: 'stun:stun1.l.google.com:19302'},
];

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'lensbridge-v1-';

type SignalingTransport = 'ws' | 'peerjs';

type PeerDataPayload =
  | {type: 'stream:meta'; meta: StreamMeta}
  | {type: 'remote:command'; command: RemoteCommand}
  | {type: 'peer:left'}
  | {type: 'room:error'; code?: string; message: string};

function generateClientRoomCode(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

export interface UseLensBridgeOptions {
  role: PeerRole;
  initialRoomCode?: string;
}

export function useLensBridge({role, initialRoomCode}: UseLensBridgeOptions) {
  const [roomCode, setRoomCode] = useState<string>(initialRoomCode ?? '');
  const [stage, setStage] = useState<ConnectionStage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signalingConnected, setSignalingConnected] = useState(false);

  // Viewer state
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteMeta, setRemoteMeta] = useState<StreamMeta | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);

  // Broadcaster state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment');
  const [quality, setQuality] = useState<VideoQualityPreset>('720p');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Refs for stable access inside async callbacks
  const roleRef = useRef<PeerRole>(role);
  roleRef.current = role;

  const transportRef = useRef<SignalingTransport>('ws');

  // WebSocket signaling refs
  const wsRef = useRef<WebSocket | null>(null);
  const wsEverOpenedRef = useRef<boolean>(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  // PeerJS serverless signaling refs (used automatically on Vercel)
  const peerRef = useRef<Peer | null>(null);
  const peerCallRef = useRef<MediaConnection | null>(null);
  const peerDataConnRef = useRef<DataConnection | null>(null);

  const iceServersRef = useRef<IceServerConfig[]>(DEFAULT_ICE_SERVERS);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeRoomRef = useRef<string>(initialRoomCode ?? '');
  const peerPresentRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBytesRef = useRef<{bytes: number; timestamp: number} | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const shouldConnectRef = useRef<boolean>(true);

  const metaRef = useRef<StreamMeta>({
    facingMode,
    audioEnabled,
    quality,
    torchSupported,
    torchEnabled,
  });
  metaRef.current = {
    facingMode,
    audioEnabled,
    quality,
    torchSupported,
    torchEnabled,
  };

  const sendSignal = useCallback((msg: ClientSignalMessage) => {
    if (transportRef.current === 'peerjs') {
      const conn = peerDataConnRef.current;
      if (conn && conn.open) {
        if (msg.type === 'stream:meta') {
          conn.send({type: 'stream:meta', meta: msg.meta} satisfies PeerDataPayload);
        } else if (msg.type === 'remote:command') {
          conn.send({
            type: 'remote:command',
            command: msg.command,
          } satisfies PeerDataPayload);
        } else if (msg.type === 'leave-room') {
          conn.send({type: 'peer:left'} satisfies PeerDataPayload);
        }
      }
      return;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const fetchServerConfig = useCallback(async (): Promise<SignalingTransport> => {
    try {
      const res = await fetch('/api/ice-servers');
      if (res.ok) {
        const data = (await res.json()) as {iceServers?: IceServerConfig[]};
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
        }
      }
    } catch {
      // Fall back to default public STUN
    }

    if (import.meta.env.VITE_SIGNALING_URL?.trim()) {
      return 'ws';
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('/api/health', {signal: controller.signal});
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          signaling?: string;
          runtime?: string;
        };
        if (data.signaling === 'ws') {
          return 'ws';
        }
        if (data.signaling === 'peerjs' || data.runtime === 'vercel-serverless') {
          return 'peerjs';
        }
      }
    } catch {
      // Static host without /api/health
    }

    return 'peerjs';
  }, []);

  const stopStatsPolling = useCallback(() => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    prevBytesRef.current = null;
    setStats(null);
  }, []);

  const startStatsPolling = useCallback(
    (pc: RTCPeerConnection) => {
      stopStatsPolling();
      statsTimerRef.current = setInterval(async () => {
        if (
          pc.connectionState !== 'connected' &&
          pc.iceConnectionState !== 'connected'
        ) {
          return;
        }
        try {
          const report = await pc.getStats();
          let width = 0;
          let height = 0;
          let fps = 0;
          let packetsLost = 0;
          let bitrateKbps = 0;
          let rttMs: number | null = null;

          report.forEach((stat) => {
            if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
              width = stat.frameWidth ?? width;
              height = stat.frameHeight ?? height;
              fps = Math.round(stat.framesPerSecond ?? 0);
              packetsLost = stat.packetsLost ?? 0;

              const bytes = stat.bytesReceived ?? 0;
              const now = stat.timestamp;
              if (prevBytesRef.current && now > prevBytesRef.current.timestamp) {
                const dtSec = (now - prevBytesRef.current.timestamp) / 1000;
                const deltaBytes = bytes - prevBytesRef.current.bytes;
                if (dtSec > 0 && deltaBytes >= 0) {
                  bitrateKbps = Math.round((deltaBytes * 8) / dtSec / 1000);
                }
              }
              prevBytesRef.current = {bytes, timestamp: now};
            } else if (
              stat.type === 'candidate-pair' &&
              stat.state === 'succeeded' &&
              typeof stat.currentRoundTripTime === 'number'
            ) {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          });

          setStats({
            width,
            height,
            fps,
            bitrateKbps,
            rttMs,
            packetsLost,
          });
        } catch {
          // Ignore transient getStats errors during teardown
        }
      }, 1000);
    },
    [stopStatsPolling],
  );

  const closePeerConnection = useCallback(() => {
    stopStatsPolling();
    pendingIceRef.current = [];

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (peerCallRef.current) {
      peerCallRef.current.close();
      peerCallRef.current = null;
    }
    if (peerDataConnRef.current) {
      peerDataConnRef.current.close();
      peerDataConnRef.current = null;
    }

    if (roleRef.current === 'viewer') {
      setRemoteStream(null);
      setRemoteMeta(null);
    }
  }, [stopStatsPolling]);

  const destroyPeerJsInstance = useCallback(() => {
    closePeerConnection();
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
  }, [closePeerConnection]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.splice(0);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidates
      }
    }
  }, []);

  const createPeerConnection = useCallback(() => {
    closePeerConnection();
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 4,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: 'signal:ice',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setStage('live');
        setErrorMessage(null);
        if (roleRef.current === 'viewer') {
          startStatsPolling(pc);
        }
      } else if (state === 'connecting') {
        setStage('negotiating');
      } else if (state === 'disconnected') {
        setStage('reconnecting');
      } else if (state === 'failed') {
        setStage('reconnecting');
        if (roleRef.current === 'broadcaster' && peerPresentRef.current) {
          pc.restartIce();
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        setStage('live');
        if (roleRef.current === 'viewer') {
          startStatsPolling(pc);
        }
      } else if (
        pc.iceConnectionState === 'failed' &&
        roleRef.current === 'broadcaster'
      ) {
        pc.restartIce();
      }
    };

    if (roleRef.current === 'viewer') {
      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
      };
    }

    pcRef.current = pc;
    return pc;
  }, [closePeerConnection, sendSignal, startStatsPolling]);

  const startOfferAsBroadcaster = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || !peerPresentRef.current) {
      return;
    }

    setStage('negotiating');
    const pc = createPeerConnection();
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);
      sendSignal({type: 'signal:offer', sdp: offer});
      sendSignal({type: 'stream:meta', meta: metaRef.current});
    } catch {
      setErrorMessage('Could not initiate live video stream.');
      setStage('error');
    }
  }, [createPeerConnection, sendSignal]);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setWakeLockActive(true);
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
          setWakeLockActive(false);
        });
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // Ignore release errors
    } finally {
      setWakeLockActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setCameraReady(false);
    setTorchSupported(false);
    setTorchEnabled(false);
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const startCamera = useCallback(
    async (
      targetFacing: CameraFacingMode = facingMode,
      targetQuality: VideoQualityPreset = quality,
      targetAudio: boolean = audioEnabled,
    ): Promise<MediaStream | null> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access requires HTTPS and a modern mobile browser.');
        return null;
      }

      setCameraError(null);
      const preset = QUALITY_DIMENSIONS[targetQuality];

      // Stop existing video tracks first so mobile hardware releases the lens cleanly
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
        localStreamRef.current = null;
      }

      const videoConstraints: MediaTrackConstraints = {
        facingMode: {ideal: targetFacing},
        width: {ideal: preset.width},
        height: {ideal: preset.height},
        frameRate: {ideal: preset.fps, max: 30},
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: targetAudio
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : false,
        });
      } catch {
        // Retry video-only in case microphone is blocked or unavailable
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          });
          setAudioEnabled(false);
        } catch (err) {
          const msg =
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'Camera permission was denied. Allow camera access in browser settings and retry.'
              : 'Unable to access your device camera.';
          setCameraError(msg);
          setCameraReady(false);
          return null;
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraReady(true);
      setTorchEnabled(false);

      const videoTrack = stream.getVideoTracks()[0];
      let hasTorch = false;
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities() as Record<string, unknown>;
        hasTorch = Boolean(caps.torch);
      }
      setTorchSupported(hasTorch);

      // Seamlessly swap tracks if already streaming to desktop
      const activePc = pcRef.current ?? peerCallRef.current?.peerConnection;
      if (activePc && activePc.connectionState !== 'closed') {
        const senders = activePc.getSenders();
        const newVideo = stream.getVideoTracks()[0];
        const newAudio = stream.getAudioTracks()[0];

        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender && newVideo) {
          await videoSender.replaceTrack(newVideo);
        }

        const audioSender = senders.find((s) => s.track?.kind === 'audio');
        if (audioSender) {
          await audioSender.replaceTrack(newAudio ?? null);
        }

        sendSignal({
          type: 'stream:meta',
          meta: {
            facingMode: targetFacing,
            audioEnabled: Boolean(newAudio),
            quality: targetQuality,
            torchSupported: hasTorch,
            torchEnabled: false,
          },
        });
      }

      return stream;
    },
    [audioEnabled, facingMode, quality, sendSignal],
  );

  const flipCamera = useCallback(async () => {
    const nextFacing: CameraFacingMode =
      facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    await startCamera(nextFacing, quality, audioEnabled);
  }, [audioEnabled, facingMode, quality, startCamera]);

  const changeQuality = useCallback(
    async (nextQuality: VideoQualityPreset) => {
      setQuality(nextQuality);
      if (localStreamRef.current) {
        await startCamera(facingMode, nextQuality, audioEnabled);
      }
    },
    [audioEnabled, facingMode, startCamera],
  );

  const toggleMic = useCallback(() => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = next;
      }
    }
    sendSignal({
      type: 'stream:meta',
      meta: {
        ...metaRef.current,
        audioEnabled: next,
      },
    });
  }, [audioEnabled, sendSignal]);

  const toggleTorch = useCallback(async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack || !torchSupported) return;
    const next = !torchEnabled;
    try {
      await videoTrack.applyConstraints({
        advanced: [{torch: next} as MediaTrackConstraintSet],
      });
      setTorchEnabled(next);
      sendSignal({
        type: 'stream:meta',
        meta: {...metaRef.current, torchEnabled: next},
      });
    } catch {
      // Ignore unsupported torch constraint errors
    }
  }, [sendSignal, torchEnabled, torchSupported]);

  // Ref wrappers for remote commands from desktop viewer
  const remoteHandlersRef = useRef({
    flipCamera,
    toggleTorch,
    toggleMic,
  });
  remoteHandlersRef.current = {flipCamera, toggleTorch, toggleMic};

  // --- PeerJS serverless signaling (used automatically on Vercel) ---
  const initPeerJsViewer = useCallback(
    (preferredCode?: string) => {
      destroyPeerJsInstance();
      setStage('connecting-signaling');
      setErrorMessage(null);

      const code = preferredCode || generateClientRoomCode();
      const peer = new Peer(`${PEER_PREFIX}${code}`, {
        secure: true,
        config: {
          iceServers: iceServersRef.current,
          iceCandidatePoolSize: 4,
        },
      });
      peerRef.current = peer;

      peer.on('open', () => {
        if (!shouldConnectRef.current || peerRef.current !== peer) return;
        activeRoomRef.current = code;
        setRoomCode(code);
        setSignalingConnected(true);
        setErrorMessage(null);
        setStage('waiting-for-peer');
      });

      peer.on('connection', (conn) => {
        if (peerDataConnRef.current && peerDataConnRef.current.open) {
          conn.on('open', () => {
            conn.send({
              type: 'room:error',
              code: 'BROADCASTER_OCCUPIED',
              message: 'Another mobile camera is already streaming in this room.',
            } satisfies PeerDataPayload);
            setTimeout(() => conn.close(), 200);
          });
          return;
        }

        peerDataConnRef.current = conn;
        conn.on('data', (raw) => {
          const data = raw as PeerDataPayload;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'stream:meta') {
            setRemoteMeta(data.meta);
          } else if (data.type === 'peer:left') {
            closePeerConnection();
            setStage('waiting-for-peer');
          }
        });
        conn.on('close', () => {
          if (peerDataConnRef.current === conn) {
            closePeerConnection();
            setStage('waiting-for-peer');
          }
        });
      });

      peer.on('call', (call) => {
        if (peerCallRef.current && peerCallRef.current.open) {
          call.close();
          return;
        }

        peerCallRef.current = call;
        setStage('negotiating');
        call.answer();

        call.on('stream', (stream) => {
          setRemoteStream(stream);
          setStage('live');
          setErrorMessage(null);
          if (call.peerConnection) {
            startStatsPolling(call.peerConnection);
          }
        });

        call.on('close', () => {
          if (peerCallRef.current === call) {
            stopStatsPolling();
            peerCallRef.current = null;
            setRemoteStream(null);
            setRemoteMeta(null);
            setStage('waiting-for-peer');
          }
        });

        if (call.peerConnection) {
          const pc = call.peerConnection;
          pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'disconnected') {
              setStage('reconnecting');
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              if (peerCallRef.current === call) {
                stopStatsPolling();
                peerCallRef.current = null;
                setRemoteStream(null);
                setStage('waiting-for-peer');
              }
            } else if (pc.connectionState === 'connected') {
              setStage('live');
              startStatsPolling(pc);
            }
          });
        }
      });

      peer.on('disconnected', () => {
        setSignalingConnected(false);
        if (shouldConnectRef.current && !peer.destroyed) {
          peer.reconnect();
        }
      });

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          initPeerJsViewer(generateClientRoomCode());
          return;
        }
        setSignalingConnected(false);
        setErrorMessage('Signaling connection interrupted. Click New Room to retry.');
        setStage('error');
      });
    },
    [closePeerConnection, destroyPeerJsInstance, startStatsPolling, stopStatsPolling],
  );

  // --- WebSocket signaling handlers ---
  const handleServerMessage = useCallback(
    async (msg: ServerSignalMessage) => {
      switch (msg.type) {
        case 'pong':
          return;

        case 'room:created': {
          activeRoomRef.current = msg.roomCode;
          setRoomCode(msg.roomCode);
          setErrorMessage(null);
          peerPresentRef.current = msg.hasBroadcaster;
          setStage(msg.hasBroadcaster ? 'negotiating' : 'waiting-for-peer');
          return;
        }

        case 'room:joined': {
          activeRoomRef.current = msg.roomCode;
          setRoomCode(msg.roomCode);
          setErrorMessage(null);
          if (msg.role === 'broadcaster') {
            peerPresentRef.current = msg.hasViewer;
            if (msg.hasViewer) {
              void acquireWakeLock();
              await startOfferAsBroadcaster();
            } else {
              setStage('waiting-for-peer');
            }
          } else {
            peerPresentRef.current = msg.hasBroadcaster;
            setStage(msg.hasBroadcaster ? 'negotiating' : 'waiting-for-peer');
          }
          return;
        }

        case 'peer:joined': {
          peerPresentRef.current = true;
          setErrorMessage(null);
          if (roleRef.current === 'broadcaster') {
            void acquireWakeLock();
            await startOfferAsBroadcaster();
          } else {
            setStage('negotiating');
          }
          return;
        }

        case 'peer:left': {
          peerPresentRef.current = false;
          closePeerConnection();
          setStage('waiting-for-peer');
          if (roleRef.current === 'broadcaster') {
            void releaseWakeLock();
          }
          return;
        }

        case 'room:error': {
          setErrorMessage(msg.message);
          if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'BROADCASTER_OCCUPIED') {
            activeRoomRef.current = '';
            setStage('error');
          }
          return;
        }

        case 'signal:offer': {
          if (roleRef.current !== 'viewer') return;
          const pc = createPeerConnection();
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            await flushPendingIce(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal({type: 'signal:answer', sdp: answer});
            setStage('negotiating');
          } catch {
            setErrorMessage('Failed to accept incoming video stream.');
            setStage('error');
          }
          return;
        }

        case 'signal:answer': {
          if (roleRef.current !== 'broadcaster' || !pcRef.current) return;
          try {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(msg.sdp),
            );
            await flushPendingIce(pcRef.current);
          } catch {
            setErrorMessage('Connection handshake failed.');
            setStage('error');
          }
          return;
        }

        case 'signal:ice': {
          const pc = pcRef.current;
          if (!pc) return;
          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch {
              // Ignore invalid candidate
            }
          } else {
            pendingIceRef.current.push(msg.candidate);
          }
          return;
        }

        case 'stream:meta': {
          if (roleRef.current === 'viewer') {
            setRemoteMeta(msg.meta);
          }
          return;
        }

        case 'remote:command': {
          if (roleRef.current !== 'broadcaster') return;
          if (msg.command.action === 'flip-camera') {
            void remoteHandlersRef.current.flipCamera();
          } else if (msg.command.action === 'toggle-torch') {
            void remoteHandlersRef.current.toggleTorch();
          } else if (msg.command.action === 'toggle-mic') {
            remoteHandlersRef.current.toggleMic();
          }
          return;
        }
      }
    },
    [
      acquireWakeLock,
      closePeerConnection,
      createPeerConnection,
      flushPendingIce,
      releaseWakeLock,
      sendSignal,
      startOfferAsBroadcaster,
    ],
  );

  const resolveSignalingUrl = useCallback((): string => {
    const configured = import.meta.env.VITE_SIGNALING_URL?.trim();
    if (configured) {
      try {
        const parsed = new URL(configured);
        if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
        if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
        if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
          if (!parsed.pathname || parsed.pathname === '/') {
            parsed.pathname = '/ws';
          }
          return parsed.toString();
        }
      } catch {
        // Fall through to same-origin default
      }
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }, []);

  const connectSignaling = useCallback(() => {
    if (transportRef.current === 'peerjs') {
      if (roleRef.current === 'viewer') {
        initPeerJsViewer(activeRoomRef.current || undefined);
      } else {
        setSignalingConnected(true);
        setStage('idle');
      }
      return;
    }

    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return;
    }

    setStage('connecting-signaling');
    wsEverOpenedRef.current = false;
    const ws = new WebSocket(resolveSignalingUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      wsEverOpenedRef.current = true;
      setSignalingConnected(true);
      setErrorMessage(null);

      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
      heartbeatTimerRef.current = setInterval(() => {
        sendSignal({type: 'ping'});
      }, 20_000);

      if (roleRef.current === 'viewer') {
        sendSignal({
          type: 'create-room',
          role: 'viewer',
          preferredCode: activeRoomRef.current || undefined,
        });
      } else if (activeRoomRef.current && localStreamRef.current) {
        sendSignal({
          type: 'join-room',
          roomCode: activeRoomRef.current,
          role: 'broadcaster',
        });
      } else {
        setStage('idle');
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerSignalMessage;
        void handleServerMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setSignalingConnected(false);
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      // If WebSocket never opened and no custom VITE_SIGNALING_URL was set,
      // automatically switch to PeerJS cloud signaling (e.g., on Vercel static hosts).
      if (
        shouldConnectRef.current &&
        !wsEverOpenedRef.current &&
        !import.meta.env.VITE_SIGNALING_URL?.trim()
      ) {
        transportRef.current = 'peerjs';
        if (roleRef.current === 'viewer') {
          initPeerJsViewer(activeRoomRef.current || undefined);
        } else {
          setSignalingConnected(true);
          setStage('idle');
        }
        return;
      }

      if (shouldConnectRef.current) {
        setStage((prev) => (prev === 'live' ? 'reconnecting' : prev));
        reconnectTimerRef.current = setTimeout(() => {
          connectSignaling();
        }, 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [handleServerMessage, initPeerJsViewer, resolveSignalingUrl, sendSignal]);

  const prevRoleRef = useRef<PeerRole>(role);

  // Initialize signaling & ICE config on mount and when role switches
  useEffect(() => {
    const effectRole = role;
    if (prevRoleRef.current !== effectRole) {
      prevRoleRef.current = effectRole;
      activeRoomRef.current = '';
      peerPresentRef.current = false;
      setRoomCode('');
      setErrorMessage(null);
      setStage('idle');
    }

    shouldConnectRef.current = true;
    void fetchServerConfig().then((detectedTransport) => {
      if (!shouldConnectRef.current) return;
      transportRef.current = detectedTransport;
      connectSignaling();
    });

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        roleRef.current === 'broadcaster' &&
        peerPresentRef.current
      ) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      shouldConnectRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
      destroyPeerJsInstance();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (effectRole === 'broadcaster') {
        stopCamera();
      }
    };
  }, [
    role,
    acquireWakeLock,
    connectSignaling,
    destroyPeerJsInstance,
    fetchServerConfig,
    stopCamera,
  ]);

  const createNewRoom = useCallback(() => {
    if (roleRef.current !== 'viewer') return;
    closePeerConnection();
    peerPresentRef.current = false;
    activeRoomRef.current = '';
    setErrorMessage(null);

    if (transportRef.current === 'peerjs') {
      initPeerJsViewer();
      return;
    }

    setStage('connecting-signaling');
    sendSignal({type: 'create-room', role: 'viewer'});
  }, [closePeerConnection, initPeerJsViewer, sendSignal]);

  const joinRoomAsBroadcaster = useCallback(
    async (codeInput: string) => {
      const cleaned = codeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleaned.length !== 6) {
        setErrorMessage('Enter a 6-character room code.');
        return false;
      }

      setErrorMessage(null);
      let stream = localStreamRef.current;
      if (!stream) {
        stream = await startCamera();
        if (!stream) return false;
      }

      activeRoomRef.current = cleaned;
      setRoomCode(cleaned);

      if (transportRef.current === 'peerjs') {
        destroyPeerJsInstance();
        setStage('connecting-signaling');

        const peer = new Peer({
          secure: true,
          config: {
            iceServers: iceServersRef.current,
            iceCandidatePoolSize: 4,
          },
        });
        peerRef.current = peer;

        peer.on('open', () => {
          if (peerRef.current !== peer) return;
          setSignalingConnected(true);
          setStage('negotiating');

          const targetPeerId = `${PEER_PREFIX}${cleaned}`;
          const conn = peer.connect(targetPeerId, {reliable: true});
          peerDataConnRef.current = conn;

          conn.on('open', () => {
            conn.send({
              type: 'stream:meta',
              meta: metaRef.current,
            } satisfies PeerDataPayload);
          });

          conn.on('data', (raw) => {
            const data = raw as PeerDataPayload;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'room:error') {
              setErrorMessage(data.message);
              destroyPeerJsInstance();
              setStage('error');
            } else if (data.type === 'remote:command') {
              if (data.command.action === 'flip-camera') {
                void remoteHandlersRef.current.flipCamera();
              } else if (data.command.action === 'toggle-torch') {
                void remoteHandlersRef.current.toggleTorch();
              } else if (data.command.action === 'toggle-mic') {
                remoteHandlersRef.current.toggleMic();
              }
            }
          });

          conn.on('close', () => {
            if (peerDataConnRef.current === conn) {
              closePeerConnection();
              peerPresentRef.current = false;
              setStage('waiting-for-peer');
              void releaseWakeLock();
            }
          });

          const call = peer.call(targetPeerId, stream);
          if (!call) {
            setErrorMessage('Unable to start call with desktop viewer.');
            setStage('error');
            return;
          }
          peerCallRef.current = call;
          peerPresentRef.current = true;
          void acquireWakeLock();

          if (call.peerConnection) {
            const pc = call.peerConnection;
            pc.addEventListener('connectionstatechange', () => {
              if (pc.connectionState === 'connected') {
                setStage('live');
                setErrorMessage(null);
              } else if (pc.connectionState === 'disconnected') {
                setStage('reconnecting');
              } else if (pc.connectionState === 'failed') {
                setStage('reconnecting');
                pc.restartIce();
              }
            });
          }

          call.on('close', () => {
            if (peerCallRef.current === call) {
              peerCallRef.current = null;
              peerPresentRef.current = false;
              setStage('waiting-for-peer');
              void releaseWakeLock();
            }
          });
        });

        peer.on('error', (err) => {
          if (err.type === 'peer-unavailable') {
            setErrorMessage(
              'Room not found. Check the code shown on your desktop viewer.',
            );
            destroyPeerJsInstance();
            activeRoomRef.current = '';
            setStage('error');
            return;
          }
          setErrorMessage('Could not connect to desktop viewer.');
          setStage('error');
        });

        return true;
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setStage('connecting-signaling');
        sendSignal({type: 'join-room', roomCode: cleaned, role: 'broadcaster'});
      } else {
        connectSignaling();
      }
      return true;
    },
    [
      acquireWakeLock,
      closePeerConnection,
      connectSignaling,
      destroyPeerJsInstance,
      releaseWakeLock,
      sendSignal,
      startCamera,
    ],
  );

  const stopBroadcast = useCallback(() => {
    sendSignal({type: 'leave-room'});
    if (transportRef.current === 'peerjs') {
      destroyPeerJsInstance();
    } else {
      closePeerConnection();
    }
    peerPresentRef.current = false;
    activeRoomRef.current = '';
    setStage('idle');
    void releaseWakeLock();
  }, [closePeerConnection, destroyPeerJsInstance, releaseWakeLock, sendSignal]);

  const sendRemoteCommand = useCallback(
    (command: RemoteCommand) => {
      if (roleRef.current !== 'viewer') return;
      sendSignal({type: 'remote:command', command});
    },
    [sendSignal],
  );

  return {
    roomCode,
    setRoomCode,
    stage,
    errorMessage,
    setErrorMessage,
    signalingConnected,
    // Viewer
    remoteStream,
    remoteMeta,
    stats,
    createNewRoom,
    sendRemoteCommand,
    // Broadcaster
    localStream,
    cameraReady,
    cameraError,
    facingMode,
    quality,
    audioEnabled,
    torchSupported,
    torchEnabled,
    wakeLockActive,
    startCamera,
    stopCamera,
    flipCamera,
    changeQuality,
    toggleMic,
    toggleTorch,
    joinRoomAsBroadcaster,
    stopBroadcast,
  };
}
