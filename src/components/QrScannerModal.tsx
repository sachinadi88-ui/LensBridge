import jsQR from 'jsqr';
import {Camera, X} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (roomCode: string) => void;
}

function extractRoomCode(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  const directMatch = trimmed.toUpperCase().match(/^[A-HJ-NP-Z2-9]{6}$/);
  if (directMatch) {
    return directMatch[0];
  }

  try {
    const parsed = new URL(trimmed);
    const param = parsed.searchParams.get('room');
    if (param) {
      const cleaned = param.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (/^[A-HJ-NP-Z2-9]{6}$/.test(cleaned)) {
        return cleaned;
      }
    }
  } catch {
    // Not a URL; ignore
  }

  const inlineMatch = trimmed.toUpperCase().match(/ROOM=([A-HJ-NP-Z2-9]{6})/);
  return inlineMatch ? inlineMatch[1] : null;
}

export function QrScannerModal({open, onClose, onDetected}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId = 0;

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError('Camera scanning requires HTTPS and browser camera permission.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}},
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setScanError(null);

        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (v && canvas && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', {willReadFrequently: true});
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (decoded?.data) {
                const code = extractRoomCode(decoded.data);
                if (code) {
                  onDetected(code);
                  return;
                }
              }
            }
          }
          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch {
        setScanError('Unable to open rear camera for QR scanning. You can type the 6-character code instead.');
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [open, onDetected]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan Desktop QR Code"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
    >
      <div className="w-full sm:max-w-md bg-[#131822] border border-white/10 rounded-t-3xl sm:rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <Camera className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-white">Scan Desktop QR Code</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {scanError ? (
            <div className="rounded-xl bg-red-500/10 border border-red-500/25 p-4 text-sm text-red-200">
              {scanError}
            </div>
          ) : (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              {/* Viewfinder framing guide */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-2xl border-2 border-blue-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 text-center">
            Point your camera at the QR code shown on the desktop viewer screen.
          </p>
        </div>
      </div>
    </div>
  );
}
