# SyncWave PWA

Reproductor multimedia sincronizado para dos o más dispositivos, en tiempo real.
Dos modos de uso:

- **Watch Party** — ver un video a distancia, todos en el mismo fotograma.
- **Altavoz sincronizado** — varios teléfonos en la misma habitación reproduciendo la misma canción al milisegundo.

Es una **PWA**: se abre desde un enlace o un código QR, sin tiendas de aplicaciones, y se instala en el móvil o en el escritorio.

## Arquitectura

**100 % serverless en Vercel.** No hay servidor Node, no hay `socket.io` y no hay estado en memoria del proceso: en serverless cada invocación es un proceso nuevo y efímero, así que cualquier estado en RAM desaparece. La única función de backend es `api/time.js`, que devuelve la hora de referencia.

| Capa | Tecnología | Para qué sirve |
| --- | --- | --- |
| **Reloj** | `GET /api/time` (Vercel) | Única referencia temporal común. Devuelve `{ t: Date.now() }` y nunca se cachea. |
| **Snapshot duradero** | tabla `rooms` en Supabase Postgres | Qué se reproduce, dónde y desde cuándo, con la posición anclada al reloj global (`sent_at_global`). Es la verdad que sobrevive a desconexiones. |
| **Eventos instantáneos** | Supabase Broadcast | Play, pause, seek, cambio de medio, emoji y chat. Llega solo a quien está conectado. |
| **Presencia** | Supabase Presence | Quién está en la sala, con alias, rol y contador en vivo. |

El reproductor de cada dispositivo **no espera órdenes continuas del servidor**. Recibe un evento puntual con `{ position, isPlaying, sentAtGlobal }`, se alinea una vez y a partir de ahí corrige por su cuenta contra el reloj global. Si el canal se cae, la reproducción continúa; solo deja de recibir órdenes nuevas.

### Sincronización

1. **Reloj.** Handshake tipo NTP contra `/api/time`: 5 muestras en serie, descarte por RTT, mediana de los offsets y recalibración cada 30 s. La precisión mostrada nunca se inventa: con menos de 3 muestras válidas la cabecera muestra `±?`.
2. **Snapshot.** Al entrar y al reconectar se lee la fila de `rooms` y la posición se proyecta con `position + (globalNow - sent_at_global) / 1000`.
3. **Deriva.** Bucle local cada 500 ms, que no publica nada al canal. Por debajo de 0.8 s se corrige con `playbackRate` 0.95–1.05 y una máquina de estados `NEUTRAL`/`CORRECTING` (histéresis, para no producir vibrato audible); por encima, un único hard seek.
4. **Orden.** Los eventos se ordenan por `seq` de cada emisor y por `sentAtGlobal`; el `eventId` aleatorio solo sirve para deduplicar.

## Funcionalidades

- Salas con código de 6 caracteres (alfabeto sin `O`, `0`, `I`, `1`) e invitación por QR o enlace compartido.
- Tres fuentes: URL directa (mp4/webm/mp3/wav/ogg), YouTube embebido y archivo local espejo.
- Compensación manual de ±200 ms por dispositivo para cornetas o audífonos Bluetooth.
- Pantalla siempre encendida (`Screen Wake Lock`) y controles en pantalla bloqueada (`Media Session`), ambos re-sincronizados al volver a la pestaña.
- Modos de permiso: control libre para todos, o solo el anfitrión controla.
- Chat y reacciones flotantes en tiempo real, con límite de frecuencia por dispositivo.

## Stack

| Capa | Tecnología |
| --- | --- |
| Cliente | React 18 + Vite + Tailwind CSS 3 + Lucide |
| PWA | `vite-plugin-pwa` (service worker `autoUpdate`, manifest standalone) |
| Tiempo real | Supabase Realtime (Broadcast + Presence) sobre canales por sala |
| Estado duradero | Supabase Postgres (tabla `rooms`, acceso solo por RPC) |
| Hosting | Vercel: SPA de Vite + función serverless `api/time.js` |

Los dos adaptadores que mantienen esto desacoplado son `client/src/lib/syncAdapter.js` (interfaz de transporte: `joinRoom`, `leaveRoom`, `sendControl`, `sendReaction`, `getSnapshot`, `subscribe`) y `client/src/lib/playerAdapter.js` (contrato de reproductor: nativo y YouTube), de modo que el bucle de deriva no sabe qué reproductor tiene delante.

## Estructura

```text
api/time.js            función serverless: { t: Date.now() }
supabase/schema.sql    tabla rooms, funciones RPC y limpieza de salas
client/                PWA en React + Vite
  src/lib/             supabase, syncAdapter, playerAdapter, constants
  src/hooks/           useClockSync, useWakeLock, useSyncRoom, useDriftCorrection
  src/components/      Lobby, RoomHeader, SyncPlayer, MediaSelector, YouTubePlayer, …
```

## Puesta en marcha

### 1. Proyecto de Supabase

Crea un proyecto en [supabase.com](https://supabase.com) y ejecuta **`supabase/schema.sql` completo** en el SQL Editor. El script crea la tabla `rooms`, las funciones `security definer` (`create_room`, `get_room`, `update_room`, `set_control_mode`, `claim_host`, `purge_stale_rooms`) y revoca el acceso directo a la tabla desde `anon`: el cliente entra solo por RPC, con el código de sala como control de acceso.

### 2. Variables de entorno

En Vercel (Settings → Environment Variables) y en `client/.env.local` para desarrollo:

```text
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key pública>
```

La `anon key` es pública por diseño: va en el bundle. La `service_role` **nunca** se usa en el cliente ni en variables `VITE_*`. Copia `client/.env.example` a `client/.env.local` y añade `client/.env.local` y `.env` al `.gitignore`. Vite lee el `.env` del directorio del proyecto, no el de la raíz.

### 3. Dependencias

```bash
cd client && npm ci
```

`npm ci` exige que `client/package-lock.json` esté commiteado y sincronizado con `package.json`: es lo que garantiza que Vercel instale exactamente las versiones que probaste en local. No lo borres ni lo regeneres para “arreglar” un build roto.

### 4. Desarrollo

```bash
npx vercel dev --listen 3000          # sirve /api/time
cd client && npm run dev -- --host    # PWA en http://localhost:5173 (proxy /api → 3000)
```

Pruebas de la lógica pura —orden de eventos, precisión del reloj, máquina de deriva, códigos de sala, identidad de archivo espejo y límites de chat y reacciones— con `node:test`, sin navegador ni Supabase:

```bash
npm test
```

### 5. Producción

```bash
npx vercel --prod
```

El `buildCommand` de `vercel.json` es `npm --prefix client ci && npm --prefix client run build`, con `client/dist` como salida y rewrite de SPA para que `?room=CODE` funcione al recargar.

## Base de datos

`rooms` guarda `code`, `media` (jsonb, `null` mientras no hay fuente), `position`, `is_playing`, `sent_at_global`, `host_id`, `control_mode`, `updated_at` y `created_at`.

- El estado publicado y la fila describen lo mismo: `{ media, position, isPlaying, sentAtGlobal }`.
- `sent_at_global` es el ancla temporal y es obligatorio junto a `position`; `updated_at` es solo auditoría y **no** se usa como base temporal.
- En modo `'host'`, `update_room` rechaza escrituras de quien no sea `host_id`.

### Limpieza de salas inactivas

```sql
select public.purge_stale_rooms(2);   -- salas en pausa sin actividad en 2 días
```

Borra únicamente salas cuyo `updated_at` caducó **y** que están en pausa: una sala reproduciendo puede tener oyentes aunque no haya escrituras recientes, así que nunca se borra. La función no tiene `grant` a `anon` (borra filas): ejecútala desde el SQL Editor o con `service_role`. **Nunca borres por `created_at`**: una sala creada hace una semana puede estar en uso ahora mismo.

## Límites y privacidad

- **El archivo local nunca se sube.** En modo espejo cada dispositivo elige su propio archivo y solo se comparte su identidad (`name`, `size`, `duration`); el `blob:` de `URL.createObjectURL` no sale del dispositivo y se revoca al cambiar de archivo o desmontar.
- **El chat es efímero**: no se guarda en la base de datos y desaparece al recargar la página.
- **Presencia**: Supabase limita a 5 `track()`/`untrack()` por cliente cada 30 s. Al superarlo cierra el canal (y con él el Broadcast), así que la app no re-trackea al cambiar de pestaña ni usa la presencia como heartbeat.
- **Canales públicos**: cualquiera con el código de la sala puede emitir y leer en ella. El código es el control de acceso y se valida con `^[A-HJ-NP-Z2-9]{6}$`.

## Limitaciones conocidas y honestas

- **YouTube sincroniza de forma aproximada (±300 ms).** La IFrame Player API no expone `playbackRate` ni un control fino de posición: sin corrección elástica, la alineación depende de seeks y de la latencia del reproductor embebido.
- **El modo Anfitrión es un bloqueo de cortesía, no seguridad.** El servidor rechaza escrituras de quien no sea `host_id` y, si el anfitrión desaparece 10 s, otro dispositivo puede reclamar el control; pero `host_id` es visible para la sala y un cliente modificado puede suplantarlo. No lo presentes como protección.
- **El reloj depende de una función serverless.** Con red mala o un cold start, la calibración tarda en estabilizarse y la cabecera lo muestra como `Reloj degradado` en vez de fingir precisión.
- **La PWA, el Service Worker y el Wake Lock solo funcionan en `https://` o en `localhost`.** Probar desde un móvil contra `http://192.168.x.x:5173` no permite instalar la PWA ni mantener la pantalla encendida: para una prueba real con dos teléfonos usa el despliegue de Vercel (que ya trae HTTPS) o un túnel HTTPS.

## Estado

La PWA está implementada en `client/`, la función de reloj en `api/time.js` y el esquema en [`supabase/schema.sql`](supabase/schema.sql). El build de producción compila sin errores y genera el service worker con los tres iconos. Para usarla falta lo que no puede venir en el repo: crear el proyecto de Supabase, ejecutar el esquema y rellenar las variables de entorno. La fuente de verdad de la arquitectura, los umbrales y las reglas de sincronización sigue siendo [`docs/prompt-syncwave-supabase.md`](docs/prompt-syncwave-supabase.md).
