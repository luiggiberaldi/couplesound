import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLOCK_RECALIBRATE_MS,
  CLOCK_RTT_FILTER_MS,
  CLOCK_SAMPLE_GAP_MS,
  CLOCK_SAMPLES,
  MIN_ACCURACY_SAMPLES
} from '../lib/constants';
import { computeClock } from '../lib/clockMath';

// Estado de reloj compartido: getGlobalNow() se usa fuera de React (adaptador y
// bucle de deriva) y por eso vive en el módulo, no en el estado del componente.
const clock = {
  offset: 0,
  accuracy: null,
  degraded: true,
  minRtt: null,
  ping: null,
  calibratedAt: 0
};

const listeners = new Set();

export function getGlobalNow() {
  return Date.now() + clock.offset;
}

export function getClockSnapshot() {
  return { ...clock };
}

function publish(patch) {
  Object.assign(clock, patch);
  const snapshot = getClockSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

async function takeSample() {
  const t0Date = Date.now();
  const t0Perf = performance.now();
  const response = await fetch(`/api/time?cacheBust=${Math.random().toString(36).slice(2)}`, {
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Reloj no disponible (${response.status})`);
  const data = await response.json();
  const serverTime = Number(data?.t);
  if (!Number.isFinite(serverTime)) throw new Error('Respuesta de reloj inválida');
  // RTT con reloj monotónico: Date.now() puede saltar durante la medición.
  const rtt = performance.now() - t0Perf;
  return { rtt, offset: serverTime - (t0Date + rtt / 2) };
}

export async function calibrateClock() {
  const samples = [];
  for (let index = 0; index < CLOCK_SAMPLES; index += 1) {
    try {
      samples.push(await takeSample());
    } catch {
      // Una muestra fallida no invalida la calibración: se descarta.
    }
    if (index < CLOCK_SAMPLES - 1) {
      await new Promise((resolve) => setTimeout(resolve, CLOCK_SAMPLE_GAP_MS));
    }
  }

  // Toda la aritmética vive en lib/clockMath.js y tiene pruebas propias.
  const result = computeClock({
    samples,
    minSamples: MIN_ACCURACY_SAMPLES,
    rttFilterMs: CLOCK_RTT_FILTER_MS
  });

  publish({
    offset: result.offset,
    accuracy: result.accuracy,
    degraded: result.degraded,
    minRtt: result.minRtt,
    ping: result.minRtt,
    calibratedAt: Date.now()
  });

  return getClockSnapshot();
}

export function useClockSync() {
  const [snapshot, setSnapshot] = useState(getClockSnapshot());
  const [calibrating, setCalibrating] = useState(false);
  const runningRef = useRef(false);

  const recalibrate = useCallback(async () => {
    if (runningRef.current) return getClockSnapshot();
    runningRef.current = true;
    setCalibrating(true);
    try {
      return await calibrateClock();
    } finally {
      runningRef.current = false;
      setCalibrating(false);
    }
  }, []);

  useEffect(() => {
    const listener = (next) => setSnapshot(next);
    listeners.add(listener);
    recalibrate();

    const interval = setInterval(recalibrate, CLOCK_RECALIBRATE_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recalibrate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', recalibrate);

    return () => {
      listeners.delete(listener);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', recalibrate);
    };
  }, [recalibrate]);

  return { ...snapshot, calibrating, recalibrate };
}
