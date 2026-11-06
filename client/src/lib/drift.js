import {
  DRIFT_CALM_CYCLES,
  DRIFT_HARD_SECONDS,
  DRIFT_HYSTERESIS_SECONDS,
  DRIFT_SOFT_SECONDS,
  RATE_FAST,
  RATE_SLOW,
  YOUTUBE_SEEK_SECONDS
} from './constants.js';

export const DRIFT_ACTIONS = {
  NONE: 'none',
  RATE: 'rate',
  SEEK: 'seek'
};

/**
 * Máquina de estados de la corrección de deriva (3.C), sin reproductor ni
 * temporizadores: recibe el drift y devuelve qué hacer con el reproductor.
 *
 * - |drift| > 0.8 s: seek (única salida que no depende de supportsRate).
 * - CORRECTING solo sale con |drift| < 0.015 s durante 2 ciclos consecutivos.
 * - La banda < 0.025 s solo actúa en NEUTRAL.
 * - Sin supportsRate (YouTube): seeks por encima de 0.3 s, nada por debajo.
 */
export function decideDrift({ drift, state = 'NEUTRAL', calmCycles = 0, supportsRate = true }) {
  const magnitude = Math.abs(drift);

  if (magnitude > DRIFT_HARD_SECONDS) {
    return {
      action: DRIFT_ACTIONS.SEEK,
      rate: 1,
      state: 'NEUTRAL',
      calmCycles: 0
    };
  }

  if (state === 'CORRECTING') {
    const nextCalmCycles = magnitude < DRIFT_HYSTERESIS_SECONDS ? calmCycles + 1 : 0;

    if (nextCalmCycles >= DRIFT_CALM_CYCLES) {
      return { action: DRIFT_ACTIONS.RATE, rate: 1, state: 'NEUTRAL', calmCycles: 0 };
    }

    if (magnitude >= DRIFT_SOFT_SECONDS) {
      return {
        action: DRIFT_ACTIONS.RATE,
        rate: drift < 0 ? RATE_FAST : RATE_SLOW,
        state: 'CORRECTING',
        calmCycles: nextCalmCycles
      };
    }

    return { action: DRIFT_ACTIONS.NONE, rate: null, state: 'CORRECTING', calmCycles: nextCalmCycles };
  }

  if (magnitude < DRIFT_SOFT_SECONDS) {
    return { action: DRIFT_ACTIONS.RATE, rate: 1, state: 'NEUTRAL', calmCycles: 0 };
  }

  if (!supportsRate) {
    return magnitude > YOUTUBE_SEEK_SECONDS
      ? { action: DRIFT_ACTIONS.SEEK, rate: null, state: 'NEUTRAL', calmCycles: 0 }
      : { action: DRIFT_ACTIONS.NONE, rate: null, state: 'NEUTRAL', calmCycles: 0 };
  }

  return {
    action: DRIFT_ACTIONS.RATE,
    rate: drift < 0 ? RATE_FAST : RATE_SLOW,
    state: 'CORRECTING',
    calmCycles: 0
  };
}
