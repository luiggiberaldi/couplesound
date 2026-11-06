import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Music, Pause, Play, RotateCcw, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useDriftCorrection } from '../hooks/useDriftCorrection';
import { useWakeLock } from '../hooks/useWakeLock';
import { getGlobalNow } from '../hooks/useClockSync';
import { createNativePlayer, isAudioSource } from '../lib/playerAdapter';
import { MANUAL_OFFSET_LIMIT_MS } from '../lib/constants';
import YouTubePlayer from './YouTubePlayer.jsx';
import TapToSyncOverlay from './TapToSyncOverlay.jsx';

const MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto'];

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export default function SyncPlayer({
  room,
  localFile,
  canControl,
  onPlay,
  onPause,
  onSeek,
  pausedUntilRef,
  manualOffsetMs,
  setManualOffsetMs
}) {
  const mediaRef = useRef(null);
  const playerRef = useRef(null);
  const suppressUntilRef = useRef(0);
  const volumeRef = useRef(1);

  const [playerReady, setPlayerReady] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [showOffset, setShowOffset] = useState(false);

  const media = room.media;
  const isYouTube = media.kind === 'youtube';
  const audioOnly = isAudioSource(media);
  const src = media.kind === 'file' ? localFile?.url ?? null : media.src;

  const { driftMs, driftState } = useDriftCorrection({
    getGlobalNow,
    playerRef,
    room,
    manualOffsetMs,
    enabled: Boolean(room.media) && playerReady,
    pausedUntilRef
  });

  const { request: requestWakeLock } = useWakeLock(Boolean(room.isPlaying) && playerReady);

  const handleYouTubeReady = useCallback((player) => {
    playerRef.current = player;
    player.setVolume(volumeRef.current);
    setPlayerReady(true);
  }, []);

  const handleEnded = useCallback(() => {
    const player = playerRef.current;
    onPause(player?.getPosition() ?? 0);
  }, [onPause]);

  // Adaptador nativo (video o audio) cuando cambia la fuente.
  useEffect(() => {
    if (isYouTube) {
      playerRef.current = null;
      setPlayerReady(false);
      return undefined;
    }
    const element = mediaRef.current;
    if (!element) return undefined;
    const player = createNativePlayer(element);
    playerRef.current = player;
    player.setVolume(volumeRef.current);
    setPlayerReady(true);
    return () => {
      if (playerRef.current === player) playerRef.current = null;
      setPlayerReady(false);
    };
  }, [isYouTube, src]);

  // Estado local del reproductor para la barra de progreso.
  useEffect(() => {
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setPosition(player.getPosition());
      setDuration(player.getDuration());
    }, 500);
    return () => clearInterval(interval);
  }, [playerReady]);

  // Aplicar el estado de la sala al reproductor (play, pause, seek).
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !room.media) return;

    if (room.isPlaying) {
      const expected =
        room.sentAtGlobal != null ? room.position + (getGlobalNow() - room.sentAtGlobal) / 1000 : room.position;
      if (Math.abs(player.getPosition() - expected) > 0.25) player.seekTo(expected);
      player.play().then(
        () => setOverlayOpen(false),
        () => setOverlayOpen(true)
      );
    } else {
      player.pause();
      player.seekTo(room.position);
    }
  }, [room.isPlaying, room.position, room.sentAtGlobal, room.media, playerReady]);

  // Eventos nativos → emisión, con la ventana de supresión de 150 ms.
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return undefined;

    const suppressed = () =>
      Date.now() < suppressUntilRef.current || Date.now() < (pausedUntilRef?.current || 0);

    const handlePlay = () => {
      if (suppressed() || !canControl) return;
      onPlay(element.currentTime);
    };
    const handlePause = () => {
      if (element.ended || suppressed() || !canControl) return;
      onPause(element.currentTime);
    };
    const handleSeeked = () => {
      if (suppressed() || !canControl) return;
      onSeek(element.currentTime);
    };

    element.addEventListener('play', handlePlay);
    element.addEventListener('pause', handlePause);
    element.addEventListener('seeked', handleSeeked);
    return () => {
      element.removeEventListener('play', handlePlay);
      element.removeEventListener('pause', handlePause);
      element.removeEventListener('seeked', handleSeeked);
    };
  }, [src, canControl, onPlay, onPause, onSeek, pausedUntilRef, playerReady]);

  // Un gesto real del usuario cancela la ventana de supresión.
  const cancelSuppression = () => {
    suppressUntilRef.current = 0;
    if (pausedUntilRef) pausedUntilRef.current = 0;
  };

  // Media Session: cada acción emite por el adapter, nunca se aplica en local.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !room.media) return undefined;
    const session = navigator.mediaSession;
    const player = () => playerRef.current;
    const guarded = (action) => (...args) => {
      if (!canControl) return;
      action(...args);
    };

    try {
      session.setActionHandler(
        'play',
        guarded(() => onPlay(player()?.getPosition() ?? room.position))
      );
      session.setActionHandler(
        'pause',
        guarded(() => onPause(player()?.getPosition() ?? room.position))
      );
      session.setActionHandler(
        'stop',
        guarded(() => onPause(player()?.getPosition() ?? room.position))
      );
      session.setActionHandler(
        'seekbackward',
        guarded((details) => onSeek(Math.max(0, (player()?.getPosition() ?? 0) - (details?.seekOffset || 10))))
      );
      session.setActionHandler(
        'seekforward',
        guarded((details) => onSeek((player()?.getPosition() ?? 0) + (details?.seekOffset || 10)))
      );
      session.setActionHandler(
        'seekto',
        guarded((details) => {
          if (typeof details?.seekTime === 'number') onSeek(details.seekTime);
        })
      );
    } catch {
      // Navegador sin soporte para alguna acción: las demás siguen activas.
    }

    session.metadata = audioOnly
      ? new MediaMetadata({ title: room.media.title || 'SyncWave', artist: 'SyncWave' })
      : null;

    return () => {
      MEDIA_ACTIONS.forEach((action) => {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Acción no soportada.
        }
      });
    };
  }, [audioOnly, canControl, onPlay, onPause, onSeek, room.media, room.position]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = room.isPlaying ? 'playing' : 'paused';
  }, [room.isPlaying]);

  // Posición para el scrubber del sistema, como máximo una vez por segundo.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return undefined;
    if (!room.isPlaying) return undefined;

    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const total = player.getDuration();
      if (!total || total <= 0) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: total,
          position: Math.min(player.getPosition(), total),
          playbackRate: 1
        });
      } catch {
        // Posición fuera de rango durante un cambio de medio.
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [room.isPlaying, room.media]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(volume);
    volumeRef.current = volume;
  }, [volume, playerReady]);

  const handleTapToSync = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    const expected =
      room.sentAtGlobal != null ? room.position + (getGlobalNow() - room.sentAtGlobal) / 1000 : room.position;
    player.setVolume(volumeRef.current);
    player.seekTo(expected);
    cancelSuppression();
    try {
      await player.play();
    } catch {
      // Sin gesto válido el overlay sigue; el usuario puede reintentar.
    }
    requestWakeLock();
  }, [requestWakeLock, room.position, room.sentAtGlobal]);

  const togglePlay = () => {
    cancelSuppression();
    const player = playerRef.current;
    const current = player?.getPosition() ?? room.position;
    if (room.isPlaying) onPause(current);
    else onPlay(current);
  };

  const commitSeek = (value) => {
    cancelSuppression();
    setDragging(false);
    onSeek(Number(value));
  };

  const progressMax = duration > 0 ? duration : 100;
  const progressValue = dragging ? dragValue : position;

  return (
    <section className="glass rounded-3xl p-3">
      <div className="relative overflow-hidden rounded-2xl bg-slate-950">
        {isYouTube ? (
          <YouTubePlayer videoId={media.src} onPlayer={handleYouTubeReady} onEnded={handleEnded} />
        ) : audioOnly ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet-500/20 via-slate-950 to-emerald-500/10">
            <Music className="h-12 w-12 text-violet-200" aria-hidden="true" />
            <p className="max-w-[80%] truncate text-sm font-semibold text-slate-200">{media.title || 'Audio'}</p>
            <audio ref={mediaRef} src={src || undefined} preload="auto" playsInline className="hidden" onEnded={handleEnded} />
          </div>
        ) : (
          <video
            ref={mediaRef}
            src={src || undefined}
            preload="auto"
            playsInline
            className="aspect-video w-full bg-black"
            onEnded={handleEnded}
          />
        )}

        {!playerReady && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/80">
            <Loader2 className="h-6 w-6 animate-spin text-violet-200" aria-hidden="true" />
            <p className="text-xs text-slate-300">Preparando el reproductor…</p>
          </div>
        )}

        {overlayOpen && room.isPlaying && <TapToSyncOverlay onTap={handleTapToSync} />}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary h-12 w-12 rounded-full p-0"
          onClick={togglePlay}
          disabled={!canControl || !playerReady}
          aria-label={room.isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {room.isPlaying ? (
            <Pause className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
          )}
        </button>

        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={progressMax}
            step={0.1}
            value={Math.min(progressValue, progressMax)}
            disabled={!canControl}
            aria-label="Posición de reproducción"
            className="w-full accent-violet-500"
            onChange={(event) => {
              setDragValue(Number(event.target.value));
              setDragging(true);
            }}
            onPointerUp={(event) => commitSeek(event.currentTarget.value)}
            onKeyUp={(event) => commitSeek(event.currentTarget.value)}
          />
          <div className="flex justify-between text-xs tabular-nums text-slate-400">
            <span>{formatClock(dragging ? dragValue : position)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Volume2 className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Volumen local"
            className="w-16 accent-emerald-400 sm:w-20"
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              driftState === 'CORRECTING' ? 'bg-amber-300' : 'bg-emerald-400'
            }`}
          />
          {driftState === 'CORRECTING' ? 'Ajustando velocidad…' : 'Sincronizado'} · {driftMs > 0 ? '+' : ''}
          {driftMs} ms
        </span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowOffset((value) => !value)}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Calibración
        </button>
      </div>

      {showOffset && (
        <div className="mt-2 rounded-xl bg-slate-900/60 px-3 py-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Retardo local</span>
            <span className="tabular-nums text-slate-200">
              {manualOffsetMs > 0 ? '+' : ''}
              {manualOffsetMs} ms
            </span>
          </div>
          <input
            type="range"
            min={-MANUAL_OFFSET_LIMIT_MS}
            max={MANUAL_OFFSET_LIMIT_MS}
            step={10}
            value={manualOffsetMs}
            aria-label="Compensación manual de retardo"
            className="mt-2 w-full accent-violet-500"
            onChange={(event) => setManualOffsetMs(Number(event.target.value))}
          />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-slate-400">Compensa el retardo de tus altavoces o del Bluetooth.</p>
            <button
              type="button"
              className="btn-ghost px-1 py-0.5 text-xs"
              onClick={() => setManualOffsetMs(0)}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Reiniciar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
