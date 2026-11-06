// Aritmética del reloj global (3.A), aislada para poder probarla sin fetch.

import { CLOCK_RTT_FILTER_MS, MIN_ACCURACY_SAMPLES } from './constants.js';

export { CLOCK_RTT_FILTER_MS, MIN_ACCURACY_SAMPLES };

export function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/**
 * Descarta picos de red: RTT por encima del límite absoluto o más del doble del
 * mejor RTT de la ronda.
 */
export function selectSamples(samples, { rttFilterMs = CLOCK_RTT_FILTER_MS } = {}) {
  if (!samples || samples.length === 0) return { usable: [], minRtt: null };
  const minRtt = Math.min(...samples.map((sample) => sample.rtt));
  const usable = samples.filter(
    (sample) => sample.rtt <= rttFilterMs && sample.rtt <= 2 * minRtt
  );
  return { usable, minRtt };
}

/**
 * Offset por mediana de las muestras válidas y precisión por IQR. Con menos de
 * `minSamples` muestras no se publica precisión: el IQR es 0 o casi 0 y la
 * cabecera mentiría con ±0 ms. El suelo físico es minRtt / 2.
 */
export function computeClock({
  samples,
  minSamples = MIN_ACCURACY_SAMPLES,
  rttFilterMs = CLOCK_RTT_FILTER_MS
} = {}) {
  if (!samples || samples.length === 0) {
    return { offset: 0, accuracy: null, degraded: true, minRtt: null, samplesUsed: 0 };
  }

  const { usable, minRtt } = selectSamples(samples, { rttFilterMs });
  if (usable.length === 0) {
    return { offset: 0, accuracy: null, degraded: true, minRtt: Math.round(minRtt), samplesUsed: 0 };
  }

  const offsets = usable.map((sample) => sample.offset);
  const offset = quantile(offsets, 0.5);
  const degraded = usable.length < minSamples;

  let accuracy = null;
  if (!degraded) {
    const iqr = quantile(offsets, 0.75) - quantile(offsets, 0.25);
    accuracy = Math.ceil(Math.max(iqr / 2, minRtt / 2));
  }

  return { offset, accuracy, degraded, minRtt: Math.round(minRtt), samplesUsed: usable.length };
}
