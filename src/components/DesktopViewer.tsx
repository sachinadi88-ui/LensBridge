import {
  Check,
  Copy,
  Flashlight,
  Link2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {
  ConnectionStage,
  RemoteCommand,
  StreamMeta,
  StreamStats,
} from '../types/stream.ts';
import {QrCodeDisplay} from './QrCodeDisplay.tsx';

interface DesktopViewerProps {
  roomCode: string;
  stage: ConnectionStage;
  errorMessage: string | null;
  signalingConnected: boolean;
  remoteStream: MediaStream | null;
  remoteMeta: StreamMeta | null;
  stats: StreamStats | null;
  onCreateNewRoom: () => void;
  onSendRemoteCommand: (cmd: RemoteCommand) => void;
}

function getStageLabel(stage: ConnectionStage, signalingConnected: boolean): {
  label: string;
  tone: 'neutral' | 'amber' | 'green' | 'red';
} {
  if (!signalingConnected && stage !== 'live') {
    return {label: 'Connecting to server', tone: 'amber'};
  }
  switch (stage) {
    case 'live':
      return {label: 'Live', tone: 'green'};
    case 'negotiating':
      return {label: 'Connecting stream', tone: 'amber'};
    case 'reconnecting':
      return {label: 'Reconnecting', tone: 'amber'};
    case 'error':
      return {label: 'Connection error', tone: 'red'};
    case 'waiting-for-peer':
      return {label: 'Waiting for mobile camera', tone: 'neutral'};
    default:
      return {label: 'Initializing', tone: 'neutral'};
  }
}

export function DesktopViewer({
  roomCode,
  stage,
  errorMessage,
  signalingConnected,
  remoteStream,
  remoteMeta,
  stats,
  onCreateNewRoom,
  onSendRemoteCommand,
}: DesktopViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const mobilePairUrl = roomCode
    ? `${window.location.origin}/?room=${roomCode}&role=camera`
    : '';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (remoteStream) {
      video.srcObject = remoteStream;
      video.play().catch(() => {
        // Browser may require gesture if unmuted
      });
    } else {
      video.srcObject = null;
    }
  }, [remoteStream]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = stageContainerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyLink = async () => {
    if (!mobilePairUrl) return;
    try {
      await navigator.clipboard.writeText(mobilePairUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const status = getStageLabel(stage, signalingConnected);
  const isLive = stage === 'live' && Boolean(remoteStream);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* Dominant Studio Monitor Stage */}
        <section
          aria-label="Live Video Monitor"
          className="bg-[#131822] border border-white/[0.08] rounded-xl overflow-hidden"
        >
          {/* Video Viewport */}
          <div
            ref={stageContainerRef}
            className="relative aspect-video w-full bg-[#07090D] flex items-center justify-center overflow-hidden"
          >
            {remoteStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isMuted}
                className={`h-full w-full ${
                  fitMode === 'cover' ? 'object-cover' : 'object-contain'
                }`}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center px-6 py-10 max-w-md">
                <div className="h-12 w-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5">
                  <Monitor className="w-6 h-6 text-slate-300" />
                </div>
                <h1 className="text-xl font-semibold text-white tracking-tight text-balance">
                  Ready for mobile camera feed
                </h1>
                <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                  Scan the QR code on the right with your phone, or enter this room code on the mobile camera view.
                </p>

                {roomCode && (
                  <div className="mt-6 flex items-center gap-3">
                    <span className="font-mono text-3xl sm:text-4xl font-semibold tracking-[0.22em] text-white select-all">
                      {roomCode}
                    </span>
                  </div>
                )}

                {errorMessage && (
                  <p className="mt-4 text-xs text-red-400">{errorMessage}</p>
                )}
              </div>
            )}

            {/* Subtle top-left live readout over active video */}
            {isLive && (
              <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/65 backdrop-blur-sm px-2.5 py-1 text-xs font-medium text-white">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Live</span>
                {remoteMeta && (
                  <>
                    <span className="text-white/40" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-200">
                      {remoteMeta.facingMode === 'environment' ? 'Rear lens' : 'Front lens'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Monitor Control & Telemetry Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-white/[0.08]">
            {/* Left: Real Connection State & Telemetry */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className={`inline-flex items-center gap-2 font-medium ${
                  status.tone === 'green'
                    ? 'text-emerald-400'
                    : status.tone === 'amber'
                      ? 'text-amber-400'
                      : status.tone === 'red'
                        ? 'text-red-400'
                        : 'text-slate-300'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status.tone === 'green'
                      ? 'bg-emerald-400'
                      : status.tone === 'amber'
                        ? 'bg-amber-400'
                        : status.tone === 'red'
                          ? 'bg-red-400'
                          : 'bg-slate-500'
                  }`}
                />
                {status.label}
              </span>

              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>

              {stats && stats.width > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 text-slate-400 font-mono">
                  <span>
                    {stats.width}×{stats.height}
                  </span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span>{stats.fps} fps</span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span>{stats.bitrateKbps} kbps</span>
                  {stats.rttMs !== null && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{stats.rttMs} ms</span>
                    </>
                  )}
                </div>
              ) : (
                <span className="text-slate-500">
                  {isLive ? 'Measuring stream telemetry...' : 'No active video stream'}
                </span>
              )}
            </div>

            {/* Right: Playback & Remote Camera Controls */}
            <div className="flex items-center gap-2">
              {isLive && (
                <>
                  <button
                    type="button"
                    onClick={() => onSendRemoteCommand({action: 'flip-camera'})}
                    className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Flip Lens
                  </button>

                  {remoteMeta?.torchSupported && (
                    <button
                      type="button"
                      onClick={() => onSendRemoteCommand({action: 'toggle-torch'})}
                      className={`h-9 px-3 rounded-lg border text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                        remoteMeta.torchEnabled
                          ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                          : 'border-white/10 text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <Flashlight className="w-3.5 h-3.5" />
                      Torch
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSendRemoteCommand({action: 'toggle-mic'})}
                    className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {remoteMeta?.audioEnabled === false ? (
                      <MicOff className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <Mic className="w-3.5 h-3.5" />
                    )}
                    {remoteMeta?.audioEnabled === false ? 'Phone Muted' : 'Phone Mic'}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                disabled={!remoteStream}
                className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {isMuted ? 'Unmute' : 'Sound On'}
              </button>

              <button
                type="button"
                onClick={() => setFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
                disabled={!remoteStream}
                className="h-9 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
              >
                {fitMode === 'contain' ? 'Fit' : 'Fill'}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="h-9 w-9 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center justify-center shrink-0"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Pairing Sidebar (Single-level card, zero nesting) */}
        <aside
          aria-label="Mobile Camera Pairing"
          className="bg-[#131822] border border-white/[0.08] rounded-xl p-5 flex flex-col gap-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Pair Mobile Camera</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Zero-login instant connection
              </p>
            </div>
            <Smartphone className="w-5 h-5 text-blue-400 shrink-0" />
          </div>

          <div className="flex justify-center py-2">
            <QrCodeDisplay value={mobilePairUrl} size={184} />
          </div>

          <div className="border-t border-white/[0.08] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Room Code</span>
              <span className="text-xs text-slate-500">Single viewer</span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg bg-[#0B0E14] border border-white/[0.08] px-3.5 py-2.5">
              <span className="font-mono text-xl font-semibold tracking-[0.2em] text-white select-all">
                {roomCode || '------'}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                disabled={!roomCode}
                className="h-8 px-2.5 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={!mobilePairUrl}
                className="h-10 px-3 rounded-lg border border-white/10 text-xs font-medium text-slate-200 hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Link Copied
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Copy Link
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onCreateNewRoom}
                className="h-10 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                New Room
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed border-t border-white/[0.08] pt-4">
            Scan the QR code with your phone camera or open this URL on mobile and enter the 6-character code.
          </p>
        </aside>
      </div>
    </div>
  );
}
