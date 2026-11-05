# SyncWave PWA

Reproductor multimedia sincronizado para dos o más dispositivos, en tiempo real.
Dos modos de uso:

- **Watch Party** — ver un video a distancia, todos exactamente en el mismo fotograma.
- **Altavoz sincronizado** — varios teléfonos en la misma habitación reproduciendo la misma canción al milisegundo.

Es una **PWA**: se abre desde un enlace o un código QR, sin tiendas de aplicaciones, y se puede instalar en el móvil o en el escritorio.

## Funcionalidades previstas

- Salas con código corto de 6 caracteres e invitación por QR o enlace compartido.
- Sincronización de relojes tipo NTP (ping/pong, RTT, mediana de 5 muestras).
- Corrección de desfase suave: `playbackRate` 0.95–1.05 en vez de saltos audibles, con hard seek solo por encima de 0.8 s.
- Compensación manual de ±200 ms para cornetas o audífonos Bluetooth.
- Pantalla siempre encendida (`Screen Wake Lock`) y controles en pantalla bloqueada (`Media Session`).
- Tres fuentes: URL directa (mp4/webm/mp3/wav/ogg), YouTube embebido y archivo local espejo en ambos dispositivos (sin subir nada).
- Modos de permiso: control libre para todos o solo el anfitrión controla.
- Chat y reacciones flotantes en tiempo real.

## Stack previsto

| Capa | Tecnología |
| --- | --- |
| Cliente | React 18 + Vite + Tailwind CSS + Lucide |
| PWA | `vite-plugin-pwa` (service worker `autoUpdate`, manifest standalone) |
| Tiempo real | Node + Express + Socket.io, detrás de un `SyncAdapter` desacoplado |
| Alternativa serverless | Supabase Realtime (Broadcast + Presence) |

## Estructura prevista

```text
server/            Express + Socket.io: salas, estado en memoria, respuesta de reloj
client/            PWA en React + Vite
  src/hooks/       useClockSync, useWakeLock, useSyncRoom
  src/components/  Lobby, RoomHeader, SyncPlayer, MediaSelector
```

## Estado

Proyecto en fase de planificación. El código se construye en modo Code.

## Desarrollo

Instrucciones de instalación y arranque (dos procesos: servidor y cliente Vite en `0.0.0.0` para abrir desde otros dispositivos en la misma red Wi-Fi) se añadirán al crear el proyecto.
