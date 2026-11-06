// Orden y deduplicación de eventos (3.E). Sin React ni red: se puede probar solo.

import { DEDUPE_LIMIT } from './constants.js';

export { DEDUPE_LIMIT };

export function createEventOrder({ dedupeLimit = DEDUPE_LIMIT } = {}) {
  const seen = new Set();
  const seenQueue = [];
  const lastSeq = new Map();
  let lastWriter = '';

  /**
   * Devuelve true si el evento debe procesarse: no es un duplicado y llega
   * después del último conocido de su emisor.
   */
  function register(envelope) {
    if (!envelope?.eventId) return false;
    if (seen.has(envelope.eventId)) return false;

    const previousSeq = lastSeq.get(envelope.deviceId) ?? -1;
    if (Number(envelope.seq) <= previousSeq) return false;

    lastSeq.set(envelope.deviceId, Number(envelope.seq));
    seen.add(envelope.eventId);
    seenQueue.push(envelope.eventId);

    while (seenQueue.length > dedupeLimit) {
      seen.delete(seenQueue.shift());
    }
    return true;
  }

  /**
   * Gana la acción de `sentAtGlobal` mayor; si empatan al milisegundo, gana el
   * deviceId lexicográficamente menor. Un evento del mismo escritor con el mismo
   * instante no es más nuevo.
   */
  function isNewer(envelope, current, lastWriterId = lastWriter) {
    if (!current || current.sentAtGlobal == null) return true;

    const incoming = Number(envelope.sentAtGlobal);
    if (incoming > current.sentAtGlobal) return true;
    if (incoming < current.sentAtGlobal) return false;

    if (!lastWriterId) return true;
    if (envelope.deviceId === lastWriterId) return false;
    return envelope.deviceId < lastWriterId;
  }

  function noteWriter(deviceId) {
    lastWriter = deviceId;
  }

  function reset() {
    seen.clear();
    seenQueue.length = 0;
    lastSeq.clear();
    lastWriter = '';
  }

  return {
    register,
    isNewer,
    noteWriter,
    reset,
    size: () => seen.size,
    lastSeqFor: (deviceId) => lastSeq.get(deviceId)
  };
}
