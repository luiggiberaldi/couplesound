import { useCallback, useEffect, useRef } from 'react';

/**
 * Ciclo de vida del Wake Lock (3.H): se vuelve a pedir al volver a `visible`,
 * se escucha el evento `release` y se libera al pausar o desmontar.
 */
export function useWakeLock(shouldHold) {
  const sentinelRef = useRef(null);
  const shouldHoldRef = useRef(shouldHold);
  shouldHoldRef.current = shouldHold;

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // Puede estar ya liberado: un release duplicado no es un error.
    }
  }, []);

  const request = useCallback(async () => {
    if (!shouldHoldRef.current) return null;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return null;
    // Con la pestaña oculta el navegador rechaza la petición.
    if (document.visibilityState !== 'visible') return null;

    await release();
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
      });
      return sentinel;
    } catch {
      // Batería baja, ahorro de energía o política del sistema: se reintenta en
      // el siguiente gesto o al volver a visible. No es un error de la app.
      return null;
    }
  }, [release]);

  useEffect(() => {
    if (shouldHold) request();
    else release();
  }, [shouldHold, request, release]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && shouldHoldRef.current) request();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [request, release]);

  return { request, release };
}
