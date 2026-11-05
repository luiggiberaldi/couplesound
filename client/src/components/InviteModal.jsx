import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Share2, X } from 'lucide-react';

export default function InviteModal({ open, code, controlMode, canControl, onSetControlMode, onClose }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?room=${code}`;

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, link, {
      width: 216,
      margin: 1,
      color: { dark: '#0f172a', light: '#e2e8f0' }
    }).catch(() => {
      // Si el canvas falla, el enlace y el botón de compartir siguen disponibles.
    });
  }, [link, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleShare = async () => {
    if (!navigator.share) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({ title: 'SyncWave', text: `Únete a mi sala ${code}`, url: link });
    } catch {
      // El usuario canceló el diálogo del sistema.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="glass w-full max-w-sm rounded-3xl p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Invitar a la sala</h2>
            <p className="text-xs text-slate-400">Cualquiera con el código entra al instante.</p>
          </div>
          <button type="button" className="btn-ghost p-2" onClick={onClose} aria-label="Cerrar invitación">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex justify-center rounded-2xl bg-slate-200/90 p-3">
          <canvas ref={canvasRef} className="h-[216px] w-[216px]" aria-label={`Código QR de la sala ${code}`} />
        </div>

        <p className="mt-4 break-all rounded-xl bg-slate-900/70 px-3 py-2 text-xs text-slate-300">{link}</p>

        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button type="button" className="btn-primary flex-1" onClick={handleShare}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Compartir
          </button>
        </div>

        {canControl && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Permisos</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={controlMode === 'free' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                onClick={() => onSetControlMode('free')}
              >
                Control libre
              </button>
              <button
                type="button"
                className={controlMode === 'host' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
                onClick={() => onSetControlMode('host')}
              >
                Modo anfitrión
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              El modo anfitrión es un bloqueo de cortesía, no seguridad: evita cortes accidentales, no protege la sala.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
