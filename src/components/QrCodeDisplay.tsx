import {QrCode} from 'lucide-react';
import QRCode from 'qrcode';
import {useEffect, useState} from 'react';

interface QrCodeDisplayProps {
  value: string;
  size?: number;
}

export function QrCodeDisplay({value, size = 200}: QrCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl(null);
      return;
    }

    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      color: {
        dark: '#0B0E14',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!value || failed) {
    return (
      <div
        style={{width: size, height: size}}
        className="flex flex-col items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 gap-2 p-4 text-center"
      >
        <QrCode className="w-8 h-8 text-slate-500" />
        <span className="text-xs">Generating pairing code...</span>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        style={{width: size, height: size}}
        className="rounded-xl bg-white/5 animate-pulse"
      />
    );
  }

  return (
    <div className="inline-flex p-3 bg-white rounded-xl shadow-sm">
      <img
        src={dataUrl}
        alt="QR code to pair mobile camera with this desktop viewer"
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="block rounded-md select-none"
      />
    </div>
  );
}
