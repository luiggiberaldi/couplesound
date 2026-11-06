import { useState } from 'react';
import { Crown, Gauge, LogOut, QrCode, Unlock, Users } from 'lucide-react';
import InviteModal from './InviteModal.jsx';

export default function RoomHeader({
  room,
  devices,
  clock,
  canControl,
  onLeave,
  onSetControlMode,
  onClaimHost,
  selfDeviceId
}) {
  const [inviteOpen, setInviteOpen] = useState(false);

  const accuracyLabel = clock.degraded ? 'Reloj degradado' : clock.accuracy != null ? `±${clock.accuracy} ms` : '±?';
  const pingLabel = clock.ping != null ? `${clock.ping} ms` : '—';
  const isHost = room.controlMode === 'host';
  const hostMissing = isHost && devices.length > 0 && !devices.some((device) => device.deviceId === room.hostId);

  return (
    <header className="glass rounded-3xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Sala</p>
          <p className="truncate text-2xl font-bold tracking-[0.3em] text-violet-200">{room.code}</p>
        </div>

        <button type="button" className="btn-secondary" onClick={() => setInviteOpen(true)}>
          <QrCode className="h-4 w-4" aria-hidden="true" />
          Invitar
        </button>
        <button type="button" className="btn-ghost" onClick={onLeave} aria-label="Salir de la sala">
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          Ping {pingLabel}
        </span>
        <span className="inline-flex items-center gap-1.5" title="Precisión estimada del reloj global">
          <span className={`h-2 w-2 rounded-full ${clock.degraded ? 'bg-rose-400' : 'bg-emerald-400'}`} />
          {accuracyLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          {devices.length} {devices.length === 1 ? 'dispositivo' : 'dispositivos'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          {isHost ? (
            <>
              <Crown className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              {room.hostId === selfDeviceId ? 'Controlas la sala' : 'Solo el anfitrión controla'}
            </>
          ) : (
            <>
              <Unlock className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
              Control libre
            </>
          )}
        </span>
      </div>

      {hostMissing && room.hostId !== selfDeviceId && (
        <button type="button" className="btn-secondary mt-3 w-full text-xs" onClick={onClaimHost}>
          El anfitrión no está: reclamar el control
        </button>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-ghost flex-1 text-xs"
          onClick={() => onSetControlMode(isHost ? 'free' : 'host')}
          disabled={!canControl}
        >
          {isHost ? 'Pasar a control libre' : 'Activar modo anfitrión'}
        </button>
      </div>

      <InviteModal
        open={inviteOpen}
        code={room.code}
        controlMode={room.controlMode}
        canControl={canControl}
        onSetControlMode={onSetControlMode}
        onClose={() => setInviteOpen(false)}
      />
    </header>
  );
}
