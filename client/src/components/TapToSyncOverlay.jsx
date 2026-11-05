import { Headphones } from 'lucide-react';

export default function TapToSyncOverlay({ onTap }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 rounded-2xl bg-slate-950/80 px-6 text-center backdrop-blur-md">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/20 text-violet-200">
        <Headphones className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="text-base font-semibold">Toca para sincronizar audio y video en vivo</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">
        Los navegadores móviles no permiten reproducir con sonido sin un gesto tuyo.
      </p>
      <button type="button" className="btn-primary" onClick={onTap}>
        Sincronizar ahora
      </button>
    </div>
  );
}
