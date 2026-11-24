export type PeerRole = 'viewer' | 'broadcaster';

export type VideoQualityPreset = '480p' | '720p' | '1080p';

export type CameraFacingMode = 'environment' | 'user';

export type ConnectionStage =
  | 'idle'
  | 'connecting-signaling'
  | 'waiting-for-peer'
  | 'negotiating'
  | 'live'
  | 'reconnecting'
  | 'error';

export interface StreamMeta {
  facingMode: CameraFacingMode;
  audioEnabled: boolean;
  quality: VideoQualityPreset;
  torchSupported: boolean;
  torchEnabled: boolean;
  width?: number;
  height?: number;
}

export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  rttMs: number | null;
  packetsLost: number;
}

export type RemoteCommand =
  | { action: 'flip-camera' }
  | { action: 'toggle-torch' }
  | { action: 'toggle-mic' };

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ClientSignalMessage =
  | { type: 'create-room'; role: 'viewer'; preferredCode?: string }
  | { type: 'join-room'; roomCode: string; role: PeerRole }
  | { type: 'leave-room' }
  | { type: 'signal:offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'signal:answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'signal:ice'; candidate: RTCIceCandidateInit }
  | { type: 'stream:meta'; meta: StreamMeta }
  | { type: 'remote:command'; command: RemoteCommand }
  | { type: 'ping' };

export type ServerSignalMessage =
  | {
      type: 'room:created';
      roomCode: string;
      hasViewer: boolean;
      hasBroadcaster: boolean;
    }
  | {
      type: 'room:joined';
      roomCode: string;
      role: PeerRole;
      hasViewer: boolean;
      hasBroadcaster: boolean;
    }
  | { type: 'peer:joined'; role: PeerRole }
  | { type: 'peer:left'; role: PeerRole }
  | { type: 'room:error'; message: string; code?: string }
  | { type: 'signal:offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'signal:answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'signal:ice'; candidate: RTCIceCandidateInit }
  | { type: 'stream:meta'; meta: StreamMeta }
  | { type: 'remote:command'; command: RemoteCommand }
  | { type: 'pong' };
