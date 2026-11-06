import { useEffect, useRef, useState } from 'react';
import { DRIFT_INTERVAL_MS } from '../lib/constants';
import { DRIFT_ACTIONS, decideDrift } from '../lib/drift';

/**
 * Bucle local de corrección de deriva (3.C). No publica nada al canal.
 * La decisión vive en lib/drift.js; aquí solo se mide y se aplica.
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

    const interval = setInterval(() => {
      const player = playerRef.current;
      const current = roomRef.current;
      if (!player || !current || current.sentAtGlobal == null) return;
      // Una orden remota acaba de mover el reproductor: no competir con el seek.
      if (pausedUntilRef?.current && Date.now() < pausedUntilRef.current) return;

      if (!current.isPlaying) {
        if (player.supportsRate) player.setRate(1);
        stateRef.current = 'NEUTRAL';
        calmCyclesRef.current = 0;
        setDriftState('NEUTRAL');
        setDriftMs(0);
        return;
      }

      const expected = current.position + (getGlobalNow() - current.sentAtGlobal) / 1000;
      const drift = player.getPosition() - expected + offsetRef.current / 1000;
      setDriftMs(Math.round(drift * 1000));

      const decision = decideDrift({
        drift,
        state: stateRef.current,
        calmCycles: calmCyclesRef.current,
        supportsRate: player.supportsRate
      });

      if (decision.action === DRIFT_ACTIONS.SEEK) {
        player.seekTo(expected);
        if (player.supportsRate) player.setRate(1);
      } else if (decision.action === DRIFT_ACTIONS.RATE && player.supportsRate) {
        player.setRate(decision.rate);
      }

      stateRef.current = decision.state;
      calmCyclesRef.current = decision.calmCycles;
      setDriftState(decision.state);
      onDriftRef.current?.(drift, decision.state);
    }, DRIFT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, getGlobalNow, playerRef, pausedUntilRef]);

  return { driftMs, driftState };
}
