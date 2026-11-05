import { useEffect, useRef, useState } from 'react';
import {
  DRIFT_CALM_CYCLES,
  DRIFT_HARD_SECONDS,
  DRIFT_HYSTERESIS_SECONDS,
  DRIFT_INTERVAL_MS,
  DRIFT_SOFT_SECONDS,
  RATE_FAST,
  RATE_SLOW,
  YOUTUBE_SEEK_SECONDS
} from '../lib/constants';

/**
 * Bucle local de corrección de deriva (3.C). No publica nada al canal.
 * Máquina de estados: NEUTRAL solo aplica la banda fina; CORRECTING solo sale
 * con |drift| < 0.015 s durante 2 ciclos consecutivos.
 */
export function useDriftCorrection({
  getGlobalNow,
  playerRef,
  room,
  manualOffsetMs,
  enabled,
  pausedUntilRef,
  onDrift
}) {
  const [driftMs, setDriftMs] = useState(0);
  const [driftState, setDriftState] = useState('NEUTRAL');

  const roomRef = useRef(room);
  roomRef.current = room;
  const offsetRef = useRef(manualOffsetMs);
  offsetRef.current = manualOffsetMs;
  const stateRef = useRef('NEUTRAL');
  const calmCyclesRef = useRef(0);
  const onDriftRef = useRef(onDrift);
  onDriftRef.current = onDrift;

  useEffect(() => {
    if (!enabled) return undefined;

    const applyElastic = (player, drift) => {
      // Atrasado (drift < 0) acelera; adelantado (drift > 0) frena.
      player.setRate(drift < 0 ? RATE_FAST : RATE_SLOW);
    };

    const interval = setInterval(() => {
      const player = playerRef.current;
      const current = roomRef.current;
      if (!player || !current || current.sentAtGlobal == null) return;
      // Una orden remota acaba de mover el reproductor: no competir con el seek.
      if (pausedUntilRef?.current && Date.now() < pausedUntilRef.current) return;

      if (!current.isPlaying) {
        if (player.supportsRate) player.setRate(1);
        calmCyclesRef.current = 0;
        stateRef.current = 'NEUTRAL';
        setDriftState('NEUTRAL');
        setDriftMs(0);
        return;
      }

      const expected =
        current.position + (getGlobalNow() - current.sentAtGlobal) / 1000;
      const drift = player.getPosition() - expected + offsetRef.current / 1000;
      const magnitude = Math.abs(drift);
      setDriftMs(Math.round(drift * 1000));

      if (magnitude > DRIFT_HARD_SECONDS) {
        player.seekTo(expected);
        if (player.supportsRate) player.setRate(1);
        stateRef.current = 'NEUTRAL';
        calmCyclesRef.current = 0;
        setDriftState('NEUTRAL');
        onDriftRef.current?.(drift, 'NEUTRAL');
        return;
      }

      if (stateRef.current === 'CORRECTING') {
        calmCyclesRef.current =
          magnitude < DRIFT_HYSTERESIS_SECONDS ? calmCyclesRef.current + 1 : 0;

        if (calmCyclesRef.current >= DRIFT_CALM_CYCLES) {
          if (player.supportsRate) player.setRate(1);
          stateRef.current = 'NEUTRAL';
          calmCyclesRef.current = 0;
          setDriftState('NEUTRAL');
        } else if (magnitude >= DRIFT_SOFT_SECONDS) {
          applyElastic(player, drift);
        }
        onDriftRef.current?.(drift, stateRef.current);
        return;
      }

      // NEUTRAL
      if (magnitude < DRIFT_SOFT_SECONDS) {
        if (player.supportsRate) player.setRate(1);
        onDriftRef.current?.(drift, 'NEUTRAL');
        return;
      }

      if (!player.supportsRate) {
        // YouTube: sin playbackRate, solo seeks y con el umbral de su precisión real.
        if (magnitude > YOUTUBE_SEEK_SECONDS) player.seekTo(expected);
        onDriftRef.current?.(drift, 'NEUTRAL');
        return;
      }

      stateRef.current = 'CORRECTING';
      setDriftState('CORRECTING');
      applyElastic(player, drift);
      onDriftRef.current?.(drift, 'CORRECTING');
    }, DRIFT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, getGlobalNow, playerRef, pausedUntilRef]);

  return { driftMs, driftState };
}
