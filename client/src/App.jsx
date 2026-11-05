import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, SlidersHorizontal, X } from 'lucide-react';
import { useClockSync } from './hooks/useClockSync';
import { useSyncRoom } from './hooks/useSyncRoom';
import { supabaseConfigured } from './lib/supabase';
import Lobby from './components/Lobby.jsx';
import RoomHeader from './components/RoomHeader.jsx';
import MediaSelector from './components/MediaSelector.jsx';
import SyncPlayer from './components/SyncPlayer.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import Reactions from './components/Reactions.jsx';

function SetupCard() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center gap-4 px-5 py-10">
      <div className="glass rounded-3xl p-6">
        <h1 className="text-2xl font-bold">Falta configurar Supabase</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Copia <code className="rounded bg-slate-800 px-1.5 py-0.5">client/.env.example</code> a{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">client/.env.local</code> y rellena{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">VITE_SUPABASE_URL</code> y{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>. Después ejecuta{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">supabase/schema.sql</code> en el SQL Editor del proyecto y
          reinicia el servidor de desarrollo.
        </p>
      </div>
    </main>
  );
}

export default function App() {
  const clock = useClockSync();
  const sync = useSyncRoom();
  const [localFile, setLocalFile] = useState(null);
  const [editingMedia, setEditingMedia] = useState(false);

  const handleLocalFile = useCallback((file) => {
    if (!file) {
      setLocalFile(null);
      return;
    }
    setLocalFile({
      name: file.name,
      size: file.size,
      type: file.type || '',
      url: URL.createObjectURL(file)
    });
  }, []);

  // Revoca el blob del archivo anterior al cambiarlo o al desmontar.
  useEffect(
    () => () => {
      if (localFile?.url) URL.revokeObjectURL(localFile.url);
    },
    [localFile]
  );

  useEffect(() => {
    if (sync.session) {
      window.history.replaceState(null, '', `?room=${sync.session.code}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [sync.session]);

  if (!supabaseConfigured) return <SetupCard />;

  if (!sync.session || !sync.room) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-5 py-10">
        <Lobby
          alias={sync.alias}
          onAliasChange={sync.setAlias}
          onCreate={sync.createRoom}
          onJoin={sync.joinRoom}
          busy={sync.status === 'connecting'}
          error={sync.error}
          onDismissError={sync.clearError}
        />
      </main>
    );
  }

  const { room } = sync;
  const needsLocalFile = room.media?.kind === 'file' && !localFile;
  const showSelector = !room.media || editingMedia || needsLocalFile;

  const handleSelectMedia = (media) => {
    sync.selectMedia(media);
    setEditingMedia(false);
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:py-8">
      <RoomHeader
        room={room}
        devices={sync.devices}
        clock={clock}
        canControl={sync.canControl()}
        onLeave={sync.leaveRoom}
        onSetControlMode={sync.setControlMode}
        onClaimHost={sync.claimHost}
        selfDeviceId={sync.deviceId}
      />

      {sync.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{sync.error}</p>
          <button type="button" onClick={sync.clearError} className="text-amber-200/80 hover:text-amber-100" aria-label="Cerrar aviso">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {showSelector && (
        <MediaSelector
          room={room}
          canControl={sync.canControl()}
          onSelectMedia={handleSelectMedia}
          localFile={localFile}
          onLocalFile={handleLocalFile}
          highlightFile={needsLocalFile}
        />
      )}

      {room.media && !needsLocalFile && (
        <SyncPlayer
          room={room}
          localFile={localFile}
          canControl={sync.canControl()}
          onPlay={sync.play}
          onPause={sync.pause}
          onSeek={sync.seek}
          pausedUntilRef={sync.pausedUntilRef}
          manualOffsetMs={sync.manualOffsetMs}
          setManualOffsetMs={sync.setManualOffsetMs}
        />
      )}

      {room.media && !editingMedia && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setEditingMedia(true)}
            disabled={!sync.canControl()}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Cambiar fuente
          </button>
        </div>
      )}

      <ChatPanel messages={sync.chatMessages} onSend={sync.sendChat} />
      <Reactions reactions={sync.reactions} onSend={sync.sendReaction} />
    </main>
  );
}
