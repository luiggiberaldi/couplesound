import { useEffect, useState } from 'react';
import { AlertTriangle, DoorOpen, Loader2, Plus } from 'lucide-react';
import { ROOM_CODE_REGEX, ROOM_CODE_LENGTH } from '../lib/constants';

export default function Lobby({ alias, onAliasChange, onCreate, onJoin, busy, error, onDismissError }) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get('room') || '').toUpperCase();
    if (fromUrl) setCode(fromUrl.slice(0, ROOM_CODE_LENGTH));
  }, []);

  const handleJoin = async (event) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!ROOM_CODE_REGEX.test(normalized)) {
      setLocalError('El código tiene 6 caracteres: letras sin O ni I y números sin 0 ni 1.');
      return;
    }
    setLocalError('');
    await onJoin(normalized);
  };

  const handleCreate = async () => {
    setLocalError('');
    await onCreate('free');
  };

  const message = localError || error;

  return (
    <div className="flex flex-col gap-5">
      <header className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/20 text-3xl">
          🎧
        </div>
        <h1 className="text-3xl font-bold tracking-tight">SyncWave</h1>
        <p className="mt-2 text-sm text-slate-400">
          El mismo video o la misma canción, al mismo tiempo, en todos tus dispositivos.
        </p>
      </header>

      {message && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{message}</p>
          <button type="button" className="text-xs underline" onClick={() => { setLocalError(''); onDismissError?.(); }}>
            Cerrar
          </button>
        </div>
      )}

      <section className="glass rounded-3xl p-5">
        <label htmlFor="alias" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Tu nombre en la sala
        </label>
        <input
          id="alias"
          className="field"
          value={alias}
          maxLength={24}
          placeholder="Invitado"
          onChange={(event) => onAliasChange(event.target.value)}
        />

        <button
          type="button"
          className="btn-primary mt-4 w-full"
          onClick={handleCreate}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-5 w-5" aria-hidden="true" />
          )}
          {busy ? 'Creando sala…' : 'Crear sala sincronizada'}
        </button>
      </section>

      <form className="glass rounded-3xl p-5" onSubmit={handleJoin}>
        <label htmlFor="room-code" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Unirse con código
        </label>
        <input
          id="room-code"
          className="field text-center text-2xl font-bold uppercase tracking-[0.4em]"
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="ABC234"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, ROOM_CODE_LENGTH))}
        />
        <button type="submit" className="btn-secondary mt-4 w-full" disabled={busy} aria-busy={busy}>
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <DoorOpen className="h-5 w-5" aria-hidden="true" />
          )}
          {busy ? 'Conectando…' : 'Entrar a la sala'}
        </button>
      </form>

      <p className="px-2 text-center text-xs leading-relaxed text-slate-400">
        Sin cuentas ni instalación: compartes un código y listo. El audio del archivo local nunca sale de tu
        dispositivo.
      </p>
    </div>
  );
}
