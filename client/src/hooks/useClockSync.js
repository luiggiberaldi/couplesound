import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLOCK_RECALIBRATE_MS,
  CLOCK_RTT_FILTER_MS,
  CLOCK_SAMPLE_GAP_MS,
  CLOCK_SAMPLES,
  MIN_ACCURACY_SAMPLES
} from '../lib/constants';

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

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
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

  if (samples.length === 0) {
    publish({ accuracy: null, degraded: true, calibratedAt: Date.now() });
    return getClockSnapshot();
  }

  const minRtt = Math.min(...samples.map((sample) => sample.rtt));
  const usable = samples.filter(
    (sample) => sample.rtt <= CLOCK_RTT_FILTER_MS && sample.rtt <= 2 * minRtt
  );
  const offsets = usable.map((sample) => sample.offset);
  const offset = quantile(offsets, 0.5);

  // Con menos de 3 muestras el IQR es 0 o casi 0 y la cabecera mentiría con ±0 ms.
  const degraded = usable.length < MIN_ACCURACY_SAMPLES;
  let accuracy = null;
  if (!degraded) {
    const iqr = quantile(offsets, 0.75) - quantile(offsets, 0.25);
    accuracy = Math.ceil(Math.max(iqr / 2, minRtt / 2));
  }

  publish({
    offset,
    accuracy,
    degraded,
    minRtt: Math.round(minRtt),
    ping: Math.round(minRtt),
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
