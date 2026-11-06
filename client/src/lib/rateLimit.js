// Límites de frecuencia de chat y reacciones (3.G), sin depender del reloj real.

export function createRateLimiter({ minIntervalMs, now = () => Date.now() }) {
  let lastAt = null;

  function canProceed(at = now()) {
    return lastAt === null || at - lastAt >= minIntervalMs;
  }

  function consume(at = now()) {
    if (!canProceed(at)) return false;
    lastAt = at;
    return true;
  }

  function reset() {
    lastAt = null;
  }

  return { canProceed, consume, reset, lastRunAt: () => lastAt };
}

/** Recorta a `maxLength` y descarta un mensaje que solo tenga espacios. */
export function normalizeChatText(text, maxLength = 200) {
  return String(text ?? '')
    .trim()
    .slice(0, maxLength);
}
