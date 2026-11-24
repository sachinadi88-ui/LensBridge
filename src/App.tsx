import {useState} from 'react';
import {DesktopViewer} from './components/DesktopViewer.tsx';
import {MobileBroadcaster} from './components/MobileBroadcaster.tsx';
import {useLensBridge} from './hooks/useLensBridge.ts';
import type {PeerRole} from './types/stream.ts';

function detectInitialMode(): {role: PeerRole; roomCode: string} {
  const params = new URLSearchParams(window.location.search);
  const rawRoom = params.get('room') ?? '';
  const cleanedRoom = rawRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const roleParam = params.get('role');

  if (roleParam === 'camera' || roleParam === 'broadcaster') {
    return {role: 'broadcaster', roomCode: cleanedRoom};
  }
  if (roleParam === 'viewer' || roleParam === 'desktop') {
    return {role: 'viewer', roomCode: cleanedRoom};
  }

  const isTouchDevice =
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 900));

  return {
    role: isTouchDevice ? 'broadcaster' : 'viewer',
    roomCode: cleanedRoom,
  };
}

export default function App() {
  const [initial] = useState(detectInitialMode);
  const [role, setRole] = useState<PeerRole>(initial.role);
  const [activeTab, setActiveTab] = useState<'studio' | 'guide'>('studio');

  const bridge = useLensBridge({
    role,
    initialRoomCode: initial.roomCode,
  });

  const handleSwitchRole = (nextRole: PeerRole) => {
    setActiveTab('studio');
    if (nextRole === role) return;
    if (role === 'broadcaster') {
      bridge.stopBroadcast();
      bridge.stopCamera();
    }
    bridge.setErrorMessage(null);
    if (nextRole === 'broadcaster') {
      bridge.setRoomCode('');
    }
    setRole(nextRole);
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="border-b border-white/[0.08] bg-[#0B0E14]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto max-w-[1440px] h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            LensBridge
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav
            aria-label="Mode and documentation"
            className="flex items-center gap-5 sm:gap-7 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => handleSwitchRole('viewer')}
              className={`whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
                activeTab === 'studio' && role === 'viewer'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Desktop Viewer
            </button>
            <button
              type="button"
              onClick={() => handleSwitchRole('broadcaster')}
              className={`whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
                activeTab === 'studio' && role === 'broadcaster'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Mobile Camera
            </button>
            <button
              type="button"
              onClick={() => setActiveTab((t) => (t === 'guide' ? 'studio' : 'guide'))}
              className={`hidden sm:inline-block whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
                activeTab === 'guide'
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              How It Works
            </button>
          </nav>

          {/* Zone 3: Single contextual primary action */}
          <div className="hidden sm:flex items-center shrink-0">
            {role === 'viewer' ? (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('studio');
                  bridge.createNewRoom();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
              >
                New Room
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSwitchRole('viewer')}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
              >
                Switch to Viewer
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1">
        {activeTab === 'guide' ? (
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 space-y-8">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight text-balance">
                Stream your mobile camera to a desktop monitor in seconds
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-400 leading-relaxed">
                LensBridge pairs one mobile device and one desktop viewer directly over the internet with WebRTC—no accounts, passwords, or native app downloads required.
              </p>
            </div>

            <div className="border-t border-white/[0.08] pt-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-white">01. Open Desktop Viewer</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Visit this URL on your desktop browser. A unique 6-character room code and QR code are generated automatically.
                </p>
              </div>
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-white">02. Pair Your Phone</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Scan the QR code with your phone camera, or open Mobile Camera mode and type the 6-character code.
                </p>
              </div>
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-white">03. Stream Live</h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your live video and audio stream directly to the desktop screen. Switch lenses, toggle mic, or change resolution anytime.
                </p>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setActiveTab('studio')}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
              >
                Return to Studio
              </button>
            </div>
          </div>
        ) : role === 'viewer' ? (
          <DesktopViewer
            roomCode={bridge.roomCode}
            stage={bridge.stage}
            errorMessage={bridge.errorMessage}
            signalingConnected={bridge.signalingConnected}
            remoteStream={bridge.remoteStream}
            remoteMeta={bridge.remoteMeta}
            stats={bridge.stats}
            onCreateNewRoom={bridge.createNewRoom}
            onSendRemoteCommand={bridge.sendRemoteCommand}
          />
        ) : (
          <MobileBroadcaster
            roomCode={bridge.roomCode}
            onChangeRoomCode={bridge.setRoomCode}
            stage={bridge.stage}
            errorMessage={bridge.errorMessage}
            localStream={bridge.localStream}
            cameraReady={bridge.cameraReady}
            cameraError={bridge.cameraError}
            facingMode={bridge.facingMode}
            quality={bridge.quality}
            audioEnabled={bridge.audioEnabled}
            torchSupported={bridge.torchSupported}
            torchEnabled={bridge.torchEnabled}
            wakeLockActive={bridge.wakeLockActive}
            onStartCamera={() => bridge.startCamera()}
            onFlipCamera={bridge.flipCamera}
            onChangeQuality={bridge.changeQuality}
            onToggleMic={bridge.toggleMic}
            onToggleTorch={bridge.toggleTorch}
            onJoinAndStream={bridge.joinRoomAsBroadcaster}
            onStopBroadcast={bridge.stopBroadcast}
          />
        )}
      </main>
    </div>
  );
}
