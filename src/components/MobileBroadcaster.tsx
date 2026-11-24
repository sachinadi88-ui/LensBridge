import {
  Camera,
  EyeOff,
  Flashlight,
  Mic,
  MicOff,
  QrCode,
  Radio,
  RotateCcw,
  Square,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import type {
  CameraFacingMode,
  ConnectionStage,
  VideoQualityPreset,
} from '../types/stream.ts';
import {QrScannerModal} from './QrScannerModal.tsx';

interface MobileBroadcasterProps {
  roomCode: string;
  onChangeRoomCode: (code: string) => void;
  stage: ConnectionStage;
  errorMessage: string | null;
  localStream: MediaStream | null;
  cameraReady: boolean;
  cameraError: string | null;
  facingMode: CameraFacingMode;
  quality: VideoQualityPreset;
  audioEnabled: boolean;
  torchSupported: boolean;
  torchEnabled: boolean;
  wakeLockActive: boolean;
  onStartCamera: () => Promise<MediaStream | null>;
  onFlipCamera: () => Promise<void>;
  onChangeQuality: (q: VideoQualityPreset) => Promise<void>;
  onToggleMic: () => void;
  onToggleTorch: () => Promise<void>;
  onJoinAndStream: (code: string) => Promise<boolean>;
  onStopBroadcast: () => void;
}

const QUALITY_OPTIONS: VideoQualityPreset[] = ['480p', '720p', '1080p'];

export function MobileBroadcaster({
  roomCode,
  onChangeRoomCode,
  stage,
  errorMessage,
  localStream,
  cameraReady,
  cameraError,
  facingMode,
  quality,
  audioEnabled,
  torchSupported,
  torchEnabled,
  wakeLockActive,
  onStartCamera,
  onFlipCamera,
  onChangeQuality,
  onToggleMic,
  onToggleTorch,
  onJoinAndStream,
  onStopBroadcast,
}: MobileBroadcasterProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pocketDim, setPocketDim] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  const isStreamingOrWaiting =
    stage === 'waiting-for-peer' ||
    stage === 'negotiating' ||
    stage === 'live' ||
    stage === 'reconnecting';

  // Attach local camera preview stream to <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (localStream) {
      video.srcObject = localStream;
      video.play().catch(() => {
        // Ignore preview autoplay issues
      });
    } else {
      video.srcObject = null;
    }
  }, [localStream]);

  // Start local camera preview immediately on entering Mobile Camera mode
  useEffect(() => {
    if (!localStream && !cameraError) {
      void onStartCamera();
    }
  }, [localStream, cameraError, onStartCamera]);

  // If arrived via QR code URL (?room=XXXXXX&role=camera), auto-join once camera is ready
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (
      urlRoom &&
      !autoJoinAttempted &&
      cameraReady &&
      stage === 'idle' &&
      roomCode.length === 6
    ) {
      setAutoJoinAttempted(true);
      void onJoinAndStream(roomCode);
    }
  }, [autoJoinAttempted, cameraReady, onJoinAndStream, roomCode, stage]);

  const handleCodeDetected = (detectedCode: string) => {
    setScannerOpen(false);
    onChangeRoomCode(detectedCode);
    void onJoinAndStream(detectedCode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onJoinAndStream(roomCode);
  };

  const statusText =
    stage === 'live'
      ? 'Live on desktop'
      : stage === 'negotiating'
        ? 'Connecting to desktop'
        : stage === 'waiting-for-peer'
          ? 'Waiting for desktop'
          : stage === 'reconnecting'
            ? 'Reconnecting'
            : cameraReady
              ? 'Camera ready'
              : 'Camera off';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 sm:py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-stretch">
        {/* Camera Viewfinder */}
        <section
          aria-label="Mobile Camera Viewfinder"
          className="relative rounded-2xl bg-[#07090D] border border-white/[0.08] overflow-hidden min-h-[54vh] sm:min-h-[62vh] flex flex-col justify-between"
        >
          {/* Live Camera Preview */}
          {localStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-cover ${
                facingMode === 'user' ? '-scale-x-100' : ''
              }`}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
              <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <Camera className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-white">
                {cameraError ? 'Camera access required' : 'Starting camera...'}
              </p>
              {cameraError && (
                <p className="mt-2 text-xs text-red-300 max-w-xs leading-relaxed">
                  {cameraError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void onStartCamera()}
                className="mt-4 min-h-[44px] px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
              >
                Enable Camera
              </button>
            </div>
          )}

          {/* Top Scrim & Compact Status */}
          <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent">
            <div className="flex items-center gap-2 text-xs font-medium text-white">
              <span
                className={`h-2 w-2 rounded-full ${
                  stage === 'live'
                    ? 'bg-emerald-400'
                    : isStreamingOrWaiting
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
                }`}
              />
              <span>{statusText}</span>
              {isStreamingOrWaiting && roomCode && (
                <>
                  <span className="text-white/40" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tracking-wider">{roomCode}</span>
                </>
              )}
            </div>

            {wakeLockActive && stage === 'live' && (
              <button
                type="button"
                onClick={() => setPocketDim(true)}
                className="min-h-[36px] px-2.5 rounded-lg bg-black/50 text-xs font-medium text-slate-200 hover:bg-black/70 inline-flex items-center gap-1.5"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Dim Screen
              </button>
            )}
          </div>

          {/* Bottom Scrim & Thumb-Zone Quick Controls */}
          <div className="relative z-10 flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-t from-black/80 via-black/45 to-transparent">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onFlipCamera()}
                disabled={!cameraReady}
                aria-label="Switch front or rear camera"
                className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-black/55 hover:bg-black/75 border border-white/15 text-xs font-medium text-white disabled:opacity-40 inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleMic}
                disabled={!cameraReady}
                aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium disabled:opacity-40 inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                  audioEnabled
                    ? 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                    : 'bg-red-500/25 border-red-400/40 text-red-100'
                }`}
              >
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                <span>{audioEnabled ? 'Mic On' : 'Muted'}</span>
              </button>

              {torchSupported && (
                <button
                  type="button"
                  onClick={() => void onToggleTorch()}
                  aria-label="Toggle flashlight"
                  className={`min-h-[44px] min-w-[44px] px-3 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 backdrop-blur-sm transition-colors ${
                    torchEnabled
                      ? 'bg-amber-500/30 border-amber-400/50 text-amber-100'
                      : 'bg-black/55 hover:bg-black/75 border-white/15 text-white'
                  }`}
                >
                  <Flashlight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quality Segmented Control */}
            <div
              role="group"
              aria-label="Stream resolution"
              className="flex items-center gap-1 p-1 rounded-xl bg-black/60 border border-white/15 backdrop-blur-sm"
            >
              {QUALITY_OPTIONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void onChangeQuality(preset)}
                  className={`min-h-[36px] px-2.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                    quality === preset
                      ? 'bg-white text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Battery-Saving Dim Screen Overlay */}
          {pocketDim && (
            <button
              type="button"
              onClick={() => setPocketDim(false)}
              className="absolute inset-0 z-30 bg-black/95 flex flex-col items-center justify-center gap-2 text-center p-6"
            >
              <span className="text-xs font-medium text-slate-400">
                Stream active · Screen dimmed
              </span>
              <span className="text-sm font-medium text-slate-200">
                Tap anywhere to restore viewfinder
              </span>
            </button>
          )}
        </section>

        {/* Thumb-Friendly Pairing & Go Live Panel */}
        <section
          aria-label="Broadcast Pairing Controls"
          className="bg-[#131822] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {isStreamingOrWaiting ? 'Connected Room' : 'Connect to Desktop'}
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {isStreamingOrWaiting
                  ? 'Your mobile camera feed is paired with the desktop viewer.'
                  : 'Scan the QR code on your desktop screen or enter the 6-character room code.'}
              </p>
            </div>

            {!isStreamingOrWaiting ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="room-code-input"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Desktop Room Code
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={6}
                    placeholder="ABC234"
                    value={roomCode}
                    onChange={(e) =>
                      onChangeRoomCode(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      )
                    }
                    className="w-full h-12 rounded-xl bg-[#0B0E14] border border-white/15 px-4 text-center font-mono text-xl font-semibold tracking-[0.25em] text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {errorMessage && (
                  <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="min-h-[48px] px-4 rounded-xl border border-white/15 text-sm font-medium text-slate-100 hover:bg-white/5 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <QrCode className="w-4 h-4 text-blue-400" />
                    Scan QR
                  </button>

                  <button
                    type="submit"
                    disabled={roomCode.length !== 6}
                    className="min-h-[48px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Radio className="w-4 h-4" />
                    Go Live
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#0B0E14] border border-white/[0.08] px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Room</span>
                  <span className="font-mono text-lg font-semibold tracking-[0.2em] text-white">
                    {roomCode}
                  </span>
                </div>

                {errorMessage && (
                  <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
                )}

                <button
                  type="button"
                  onClick={onStopBroadcast}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Square className="w-4 h-4 fill-current" />
                  Stop Streaming
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed border-t border-white/[0.08] pt-4">
            Keep this tab visible while streaming so your mobile browser maintains camera capture.
          </p>
        </section>
      </div>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleCodeDetected}
      />
    </div>
  );
}
