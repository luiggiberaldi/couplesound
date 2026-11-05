# PROMPT MAESTRO — SyncWave PWA (Supabase Realtime + Vercel)

## ROL Y OBJETIVO

Actúa como Arquitecto de Software Principal e Ingeniero Full-Stack Senior especialista en Progressive Web Apps, sincronización multimedia de baja latencia y arquitecturas serverless en tiempo real.

Construye desde cero **SyncWave PWA**: una Progressive Web App instalable y lista para producción que permita a dos o más dispositivos reproducir el mismo video o la misma canción exactamente al mismo tiempo, en dos modos: **Watch Party** (a distancia) y **Altavoz Sincronizado** (misma habitación, varios teléfonos a la vez).

El proyecto se despliega **100 % serverless en Vercel**. No existe un servidor Node propio, no existe `socket.io` y **no existe estado en memoria del proceso**: en serverless cada invocación es un proceso nuevo y efímero, así que cualquier estado guardado en RAM desaparece. Toda la arquitectura está diseñada alrededor de esa restricción.

---

## 0. REGLAS DURAS (no negociables)

1. **Tiempo real:** únicamente **Supabase Realtime** con **Broadcast** (eventos instantáneos) y **Presence** (quién está conectado). Prohibido `socket.io`, WebSockets propios o `setInterval` de polling de estado.
2. **Servidor:** la única función de backend es `api/time.js` (endpoint de reloj). No hay más lógica de servidor.
3. **Estado de sala:** vive en una tabla Postgres de Supabase (`rooms`), nunca en memoria. Broadcast no es almacenamiento: es efímero y no llega a quien no estaba conectado.
4. **Prohibido WebRTC y `captureStream()`.** El "archivo local espejo" no transmite el archivo: cada dispositivo ya lo tiene y solo se sincroniza la posición de reproducción.
5. **Código completo y funcional.** Ningún `// TODO`, ningún `// implementar aquí`, ningún placeholder vacío. Si algo es opcional, no lo menciones.
6. Toda la interfaz y los textos visibles, en español.

---

## 1. STACK TECNOLÓGICO

- **Frontend:** React 18 + Vite, Tailwind CSS 3 (con `tailwind.config.js` + `postcss.config.js`, nunca el CDN ni clases inventadas), Lucide React (iconos), `@supabase/supabase-js` v2 y `qrcode` (render del QR en canvas, sin API externa).
- **PWA:** `vite-plugin-pwa` con `registerType: 'autoUpdate'`, service worker Workbox y `manifest` completo (standalone, orientación any, iconos 192/512 + maskable, `theme_color` y `background_color` oscuros).
- **Tiempo real:** Supabase Realtime (Broadcast + Presence) sobre canales por sala.
- **Estado duradero:** Supabase Postgres, tabla `rooms` (SQL exacto en la sección 4).
- **Hosting:** Vercel — Vite SPA + una función serverless en `api/time.js`.
- **APIs nativas obligatorias:** `navigator.wakeLock`, `navigator.mediaSession`, `HTMLMediaElement`, YouTube IFrame Player API, `navigator.share`, Clipboard API.

---

## 2. ARQUITECTURA (flujo de datos)

Tres capas, cada una con un trabajo distinto. No las mezcles:

| Capa | Tecnología | Para qué sirve | Latencia |
| --- | --- | --- | --- |
| **Snapshot duradero** | tabla `rooms` en Postgres | Qué se está reproduciendo, dónde y desde cuándo, con la posición anclada al reloj global (`sent_at_global`). Es la verdad que sobrevive a desconexiones. | ~100 ms (lectura al entrar) |
| **Eventos instantáneos** | Supabase Broadcast | "Play", "Pause", "Seek", "Cambio de medio", "Emoji". Llega a los conectados al instante. | ~20–80 ms |
| **Presencia** | Supabase Presence | Lista de dispositivos, alias, rol y contador en vivo. | ~1 s |
| **Reloj** | `GET /api/time` en Vercel | Única referencia temporal común. Devuelve `{ t: Date.now() }`. | medido |

**Regla de oro:** el reproductor de cada dispositivo **nunca** espera órdenes continuas del servidor. Recibe un evento puntual con `{ position, isPlaying, sentAtGlobal }`, se alinea una vez y a partir de ahí corrige por su cuenta contra el reloj global. Si el canal se cae, la reproducción no se detiene; solo deja de recibir órdenes nuevas.

Un evento de Broadcast y la fila de `rooms` describen **el mismo estado con la misma forma**: `{ media, position, isPlaying, sentAtGlobal }`. La diferencia es que el evento caduca con el canal y la fila sobrevive. Por eso `rooms` guarda su propio `sent_at_global` y no reutiliza `updated_at`: si la base temporal del snapshot no es el Reloj Maestro Global, la corrección de deriva calcula mal desde el primer ciclo.

**Quién escribe el estado:** con `control_mode = 'free'` cualquier dispositivo puede actuar; con `'host'` solo el creador (bloqueo de cortesía, ver 3.F). En ambos casos, el dispositivo que ejecuta la acción hace dos cosas en paralelo: (a) emite el Broadcast inmediato y (b) llama a la RPC `update_room` con debounce de 250 ms. El servidor no arbitra el orden: lo resuelve la regla de orden de 3.E.

---

## 3. PROBLEMAS CRÍTICOS DE INGENIERÍA QUE DEBES RESOLVER

### A. Sincronización de relojes tipo NTP contra `/api/time`

Los relojes de dos dispositivos nunca coinciden. Sin `clockOffset` no hay sincronización posible.

El endpoint `api/time.js` es una función serverless de Vercel que responde `{ "t": <Date.now()> }` con cabeceras `Cache-Control: no-store, no-cache, must-revalidate` y `Access-Control-Allow-Origin` del mismo origen. Debe responder en milisegundos y no tocar Supabase.

Handshake en el cliente (`useClockSync`):
1. `t0Date = Date.now()`, `t0Perf = performance.now()`. Petición `GET /api/time?cacheBust=<random>`.
2. `t1Date = Date.now()`, `t1Perf = performance.now()`. `serverTime` viene en la respuesta.
3. Latencia de red: `rtt = t1Perf - t0Perf` (usa el reloj monotónico para el RTT: `Date.now()` puede saltar por ajustes del sistema durante la medición).
4. `latency = rtt / 2`; `offset = serverTime - (t0Date + latency)`.
5. **5 muestras por calibración**, en serie y no en paralelo para no saturar Vercel.
6. Descarta las muestras con `rtt > 2 × minRtt` (picos de red o cold start de la función) y descarta muestras con `rtt > 800 ms`. Con las restantes, toma la **mediana** de los `offset` (la mediana ignora valores atípicos; un promedio se contamina).
7. Recalibra cada **30 s** y también al volver del evento `visibilitychange` a visible y al reconectar Supabase.
8. Expón `getGlobalNow()` que devuelve `Date.now() + clockOffset`, y `accuracy` para mostrarla en la UI. **`accuracy` exige un mínimo de muestras**: descarta primero las que fallan el filtro de RTT y, si quedan menos de 3, no calcules precisión — marca `degraded` y muestra `±?` en vez de un número. Con `n ≥ 3`, `accuracy = (q75 − q25) / 2` sobre los `offset` usados; con 1 o 2 muestras el IQR es 0 o casi 0 y la cabecera mentiría con `±0 ms`. Nunca presentes un `accuracy` menor que `minRtt / 2` (el suelo físico que impone la asimetría de la red): redondea hacia arriba y toma el mayor de los dos.
9. Si las 5 muestras fallan (offline, función caída), marca estado `degraded`: la app sigue funcionando con offset 0 y lo avisa en la cabecera. Nunca bloquees la sala por no tener reloj.

Toda orden de reproducción se expresa en **Reloj Maestro Global**: `globalNow = Date.now() + clockOffset`. Los eventos enviados llevan `sentAtGlobal`; el receptor calcula `target = position + (globalNow - sentAtGlobal) / 1000`. No uses `updated_at` de Postgres para esto: es el reloj de Postgres, no el global, y no tiene por qué coincidir con `/api/time`. El snapshot inicial se ancla con la columna `sent_at_global` (3.B), nunca con `updated_at`.

### B. Estado de sala sin memoria de servidor

No puedes tener `roomState` en un objeto Node: desaparece. Antes de nada resuelve la identidad del dispositivo (B.1): sin ella no hay presencia, ni anfitrión, ni orden de eventos posible.

**B.1 Identidad de dispositivo.** Cada pestaña genera una vez un `deviceId` (uuid v4) y lo guarda en `sessionStorage` bajo `sw_device_id`. El `alias` de presentación vive en `localStorage` y puede repetirse. La identidad es **por pestaña**: dos pestañas del mismo móvil son dos reproductores independientes y deben poder sincronizarse entre sí. `deviceId` viaja en el `key` de la presencia, en `host_id` y en el sobre de cada evento. No es seguridad: es identificación.

**B.2 Anclaje del snapshot.** `rooms.sent_at_global` es la base temporal compartida: el epoch en milisegundos del Reloj Maestro Global del emisor, correspondiente al instante en que `position` era válida. `position` es la posición en ese instante, no en `updated_at`. Si `sent_at_global` es null (sala sin fuente elegida todavía), la posición se usa tal cual y el bucle de deriva queda inerte.

El flujo correcto es:

- **Al crear la sala:** genera un código de 6 caracteres con alfabeto sin ambigüedad (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, sin `O`, `0`, `I`, `1`), llama a la RPC `create_room(code, deviceId, controlMode)` y reintenta hasta 5 veces si responde "Código de sala ocupado" (violación de PK). Nada de códigos aleatorios sin comprobar colisión. La sala nace con `media = null` y `host_id = deviceId` del creador.
- **Al entrar:** valida el código con `^[A-HJ-NP-Z2-9]{6}$` y llama a la RPC `get_room(code)`; la tabla no es legible por `anon` (3.F). Si no existe, error claro ("Esa sala no existe o ya se cerró"). Simultáneamente suscríbete al canal y haz `track({ device_id, alias, joined_at })` de presencia.
- **Al anclar (entrada y reconexión):** `roomState = { ...fila, sentAtGlobal: fila.sent_at_global }`. Si `is_playing`, `expectedPosition = position + (getGlobalNow() - sentAtGlobal) / 1000`. Sin `sentAtGlobal` no hay anclaje: no lo sustituyas por `updated_at` ni por `Date.now()` local (el reloj local aún no está calibrado).
- **Al actuar:** todo evento lleva el sobre `{ eventId, deviceId, seq, sentAtGlobal }` más su payload. `seq` es un contador monótono guardado en `localStorage` (`sw_seq`) que nunca se reinicia, ni al recargar. El emisor emite el Broadcast y, en paralelo, llama a `update_room(code, deviceId, media, position, isPlaying, sentAtGlobal)` con debounce de 250 ms. Ese `sentAtGlobal` es el de la acción, **no** `Date.now()` en el momento de la escritura: si lo recalcularas, la posición guardada dejaría de corresponder al instante publicado. Last-write-wins con la regla de orden de 3.E.
- **Al cambiar permisos:** `set_control_mode(code, deviceId, mode)`. Es la única vía para pasar a `'host'` y fija `host_id` al llamante.
- **Al salir:** `untrack()` y `removeChannel`. No borres la fila al salir del primer dispositivo: la sala debe sobrevivir a una recarga.

**B.3 Anfitrión ausente (traspaso).** Si `control_mode = 'host'` y `host_id` deja de aparecer en `presenceState()` durante 10 s, la sala no puede quedarse bloqueada: el dispositivo conectado con `joined_at` más antiguo (desempate por `deviceId` lexicográfico) llama a `claim_host(code, deviceId)` y la UI muestra "Ahora controlas la sala". El anfitrión también puede ceder el control desde el modal de invitación, reescribiendo `host_id` con el `deviceId` elegido. El servidor no ve Presencia, así que la detección es de cliente: sigue siendo un bloqueo de cortesía, no un mecanismo de seguridad.

### C. Corrección de desfase suave (soft vs. hard drift)

Saltar con `player.seekTo(target)` produce un corte audible. Bucle de monitoreo **local** cada 500 ms, **que no publica nada al canal** (solo compara). El bucle no toca `HTMLMediaElement` ni el player de YouTube directamente: habla con una **interfaz de reproductor** (C.1), porque la IFrame API no tiene `playbackRate` ni un `currentTime` preciso.

**C.1 Interfaz mínima del reproductor.** `SyncPlayer` (video/audio nativo) y `YouTubePlayer` implementan el mismo contrato en `lib/playerAdapter.js`, y el bucle de deriva solo conoce este contrato:

| Miembro | Nativo | YouTube |
| --- | --- | --- |
| `getPosition(): number` | `media.currentTime` | `player.getCurrentTime()` |
| `getDuration(): number` | `media.duration` | `player.getDuration()` |
| `seekTo(seconds): void` | `media.currentTime = s` | `player.seekTo(s, true)` |
| `setRate(rate): void` | `media.playbackRate = rate` | no-op (`supportsRate = false`) |
| `play(): Promise<void>` | `media.play()` | `player.playVideo()` |
| `pause(): void` | `media.pause()` | `player.pauseVideo()` |
| `supportsRate: boolean` | `true` | `false` |

En nativo, fija `media.preservesPitch = true` explícitamente antes de tocar `playbackRate`: compensa el tono (no el tempo) y no todos los navegadores resuelven igual el valor por defecto. En YouTube `supportsRate` es `false`, así que el bucle **solo** puede usar `seekTo`: su precisión es la de la limitación conocida del README (±300 ms), sin prometer más en la UI.

Bucle, cada 500 ms:

- `expectedPosition = roomState.position + ((globalNow - roomState.sentAtGlobal) / 1000)` cuando está reproduciendo.
- `drift = player.getPosition() - expectedPosition`, **más** el offset manual del dispositivo (sección 5): `drift += manualOffsetMs / 1000`.
- **|drift| > 0.800 s:** *hard seek* a `expectedPosition`, `setRate(1.0)` y estado `NEUTRAL`. Es la única corrección que no depende de `supportsRate` y por eso es la red de seguridad de todos los modos.
- **0.025 s ≤ |drift| ≤ 0.800 s:** pasa a `CORRECTING`. Elástico: atrasado (`drift < 0`) → `playbackRate = 1.05`; adelantado (`drift > 0`) → `playbackRate = 0.95`. Si `supportsRate` es `false` (YouTube), no hay ajuste elástico: haz `seekTo` cuando `|drift| > 0.300 s` y, por debajo de eso, no intervengas.
- **|drift| < 0.025 s:** si el estado es `NEUTRAL`, `setRate(1.0)` y nada más. Si el estado es `CORRECTING`, **no hagas nada**: manda la regla siguiente.
- **Salida de `CORRECTING` (histéresis):** solo vuelves a `1.0` y a `NEUTRAL` cuando `|drift| < 0.015 s` durante **2 ciclos consecutivos**. Esa es la única forma de salir, aunque el drift ya esté por debajo de 0.025 s. Las dos reglas no compiten si se implementan como máquina de estados: la banda `< 0.025` solo actúa en `NEUTRAL`. Sin ese orden el reproductor oscila entre 0.95 y 1.05 y produce un vibrato audible.
- **Por qué el hard seek sigue siendo necesario:** a 5 % de corrección se arreglan 50 ms por segundo de reproducción, así que 0.8 s de desfase tardarían 16 s en corregirse y el tempo audible cambiaría durante todo ese tramo. El umbral de 0.8 s es lo que evita que el ajuste elástico se eternice.
- Si el reproductor está pausado, el bucle no corrige ni toca `playbackRate`: solo compara al reanudar.
- Si `expectedPosition` supera `getDuration()`, fija el final y marca pausado localmente.

### D. Desbloqueo de autoplay en móviles (iOS Safari / Chrome Android)

Ningún `.play()` con sonido funciona sin gesto previo del usuario. Si un invitado entra a una sala ya en reproducción:

- Muestra un overlay Glassmorphism centrado: **"Toca para sincronizar audio y video en vivo"**.
- Al tocar: crea y reanuda un `AudioContext` (aunque no lo uses para nada audible: desbloquea la pila de audio en iOS), llama a `media.play()`, solicita el `WakeLock`, hace un seek inmediato al instante actual y oculta el overlay.
- Si la sala está en pausa, el overlay aparece igual pero el toque solo prepara el reproductor.
- En ningún caso intentes autoplay silencioso con `muted` + luego desmutear sin gesto: en iOS el video se queda pausado y en Android el usuario no oye nada.

### E. Prevención de ecos y duplicados

- Configura el canal con `broadcast: { self: false }`: Supabase no reenvía el mensaje a quien lo emite.
- Añade igualmente `isRemoteActionRef.current = true` cada vez que el reproductor cambie por una orden remota, e ignora los eventos nativos `onPlay`, `onPause`, `onSeeked` durante 150 ms, para que el receptor no re-emita la acción recibida. La ventana silencia **solo** eventos nativos: un clic en la UI, una acción de Media Session o una tecla del usuario la cancelan y se emiten igual. Si se traga una acción del usuario, el reproductor deja de responder y la sala se desincroniza sin ningún error visible.
- Deduplica por `eventId` (uuid v4) con un set acotado a los últimos 200 ids, y por emisor: descarta eventos con `seq <= lastSeq[deviceId]` (duplicados o reordenados) y actualiza `lastSeq[deviceId] = seq` al aceptarlos.
- El `eventId` sirve **solo** para deduplicar: un uuid v4 es aleatorio y no tiene orden temporal. Nunca ordenes eventos comparando uuids.
- Para acciones concurrentes de dispositivos distintos, gana la de `sentAtGlobal` mayor; si empatan al milisegundo, gana el `deviceId` lexicográficamente menor. Todos los receptores aplican el mismo desempate, así que convergen al mismo estado.
- Al aplicar una orden remota, pausa tu propio bucle de deriva durante 300 ms para que no compita con el seek.

### F. Seguridad realista (no simules lo que no tienes)

- La `anon key` de Supabase es pública por diseño: va en el bundle y está bien. La `service_role` **nunca** aparece en el cliente ni en `VITE_*`.
- **La tabla `rooms` no se expone a `anon`.** Sin políticas y con privilegios revocados, cualquier `select`, `insert` o `update` directo falla; el cliente entra solo por RPC `security definer` (`create_room`, `get_room`, `update_room`, `claim_host`, `set_control_mode`), una llamada por código conocido. Con `using (true)` en `select` un `select * from rooms` devolvería todas las salas del proyecto con su medio y su estado, y un `update` podría reescribir el `code` (clave primaria) o el `media` de cualquier sala: el código dejaría de ser el control de acceso.
- Con canales públicos, cualquiera con el código de la sala puede emitir y leer. **Modo Host es un bloqueo de cortesía**, no seguridad: `update_room` rechaza escrituras de quien no sea `host_id` (endurece la regla, que antes era solo de cliente), pero `host_id` es visible para los miembros de la sala, así que un cliente modificado puede suplantarlo. Documéntalo tal cual en el README, sin prometer protección.
- Opcional y bien separado: deja preparado el interruptor `VITE_PRIVATE_ROOMS=true` que cree los canales con `config: { private: true }` y documento el SQL de políticas RLS sobre `realtime.messages`. Si no está activo, los canales son públicos.
- Valida el formato del código de sala antes de consultar (regex `^[A-HJ-NP-Z2-9]{6}$`, alineado con el alfabeto del generador y con la RPC) y valida las URLs de medios (solo `http`/`https`, sin `javascript:`) y el `videoId` de YouTube (`^[A-Za-z0-9_-]{11}$`) antes de construir la URL del iframe.

### G. Límites de Supabase Realtime y Vercel

- No conviertas el canal en un bus de alta frecuencia. **Solo eventos discretos** (play, pause, seek, cambio de medio, emoji, chat). El bucle de deriva y las calibraciones de reloj no publican nada salvo el evento explícito "Re-sincronizar".
- Un `seek` mientras se arrastra la barra: emite un solo evento al soltar (`onPointerUp`), no en cada movimiento.
- **Chat y reacciones tienen límite por dispositivo.** Reacciones: agrupa la ráfaga y emite como máximo **1 evento cada 150 ms** con `{ emoji, count }`, nunca un evento por toque. Chat: **1 mensaje cada 2 s**, máximo 200 caracteres y solo texto; ni imágenes ni `data:` URLs, porque el payload de Broadcast en el plan Free es de 256 KB y un archivo en base64 lo revienta y tumba el canal para todos. El proyecto entero comparte 100 msg/s, así que ese presupuesto se reparte entre todas las salas: al superar el límite local la UI deshabilita el envío y descarta el mensaje, jamás acumula una cola que dispare todo junto al liberarse. El chat es efímero (no se guarda en `rooms` y desaparece al recargar): dilo en la UI, no lo presentes como historial.
- El canal se re-suscribe solo tras una desconexión (`supabase.realtime.onError`, `visibilitychange`); al reconectar, recalibra reloj, vuelve a leer el snapshot de `rooms` y re-sincroniza la presencia según el punto siguiente.
- **Presencia: máximo 5 `track()`/`untrack()` por cliente cada 30 s.** Al sexto, Supabase cierra el canal con `ClientPresenceRateLimitReached` y **se lleva también el Broadcast**: alternar de pestaña o una red inestable pueden tumbar la sala entera. Reglas: (a) `track()` una sola vez al entrar, no en cada reconexión del canal — supabase-js reenvía la presencia al re-unirse; (b) si tras reconectar hay que re-trackear, hazlo solo si el payload cambió de verdad; (c) no hagas `untrack()` + `track()` en `visibilitychange`: ocultar la pestaña no es salir de la sala y la presencia caduca sola; (d) nunca uses `track()` como heartbeat, cada llamada cuenta para el límite. `untrack()` solo al salir de la sala.
- No abras un canal por cada cambio de medio: reutiliza `room:<code>` durante toda la sesión.

### H. Ciclo de vida de Wake Lock y Media Session

**Wake Lock.** El `WakeLockSentinel` se libera solo cuando la pestaña pasa a oculta y no vuelve por su cuenta, así que pedirlo una vez no mantiene la pantalla encendida. `useWakeLock` debe:

- Pedirlo al empezar a reproducir y tras el gesto de 3.D (el momento que iOS acepta).
- Escuchar el evento `release` del sentinel y `visibilitychange`: al volver a `visible` con `is_playing`, volver a pedirlo. Si el navegador lo niega (batería baja, pestaña oculta, política del sistema), no lances error: actualiza el estado de la UI y reintenta en el siguiente gesto o al volver a `visible`.
- Liberarlo explícitamente al pausar, al terminar el medio y al desmontar (`sentinel.release()` dentro de `try/catch`: puede estar ya liberado y ese `release()` duplicado no debe romper nada).
- Guardar siempre el último sentinel y liberar el anterior antes de pedir otro: `request()` devuelve uno nuevo en cada llamada.
- No lo pidas si `document.visibilityState !== 'visible'`: el navegador lo rechaza y solo ensucia la consola.

**Media Session.** Registrar `setActionHandler` no sincroniza nada: cada acción debe **emitir** por el adapter (`sendControl`) y dejar que el evento mueva el reproductor. Si la aplicas en local sin emitir, la sala se parte en dos estados y no hay ningún error visible. Concretamente:

- `play` / `pause`: emiten `{ type: 'play' | 'pause', position: player.getPosition(), sentAtGlobal: getGlobalNow() }`; si el modo es `'host'` y no eres el anfitrión, la UI muestra "Solo el anfitrión controla" y no emite.
- `seekbackward` / `seekforward` / `seekto`: mismos límites que la barra de progreso (un evento al soltar, no por paso) y usa `seekoffset`/`seekTime` cuando vengan en los detalles.
- `stop`: pausa sincronizada. `nexttrack`/`previoustrack` no se registran (no hay cola).
- Metadatos (`MediaMetadata`) solo en modo audio, con el título del medio, y `setPositionState` actualizado como máximo una vez por segundo para el scrubber del sistema.
- Mantén `navigator.mediaSession.playbackState` en `'playing'`/`'paused'`/`'none'` según el estado real, o los controles del sistema muestran el icono equivocado.
- Las acciones de Media Session **nunca** caen dentro de la ventana de supresión de 150 ms de 3.E: esa ventana es solo para eventos nativos que tú mismo provocaste.

---

## 4. MODELO DE DATOS (SQL exacto, inclúyelo en `supabase/schema.sql`)

```sql
create table if not exists public.rooms (
  code           text primary key,
  media          jsonb,
  position       double precision not null default 0,
  is_playing     boolean not null default false,
  sent_at_global bigint,
  host_id        text not null,
  control_mode   text not null default 'free' check (control_mode in ('free', 'host')),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Sin políticas y sin privilegios: anon no lee ni escribe la tabla directamente.
-- El código de 6 caracteres sigue siendo el control de acceso, pero solo se ejerce
-- por las RPC de abajo, una llamada por código conocido (no hay listados).
revoke all on table public.rooms from anon, authenticated;

create or replace function public.assert_room_code(p_code text)
returns void language plpgsql immutable as $$
begin
  if p_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'Código de sala inválido' using errcode = '22023';
  end if;
end $$;

create or replace function public.create_room(
  p_code text, p_device_id text, p_control_mode text default 'free'
) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  if p_device_id is null or length(p_device_id) > 64 then
    raise exception 'deviceId inválido' using errcode = '22023';
  end if;
  if p_control_mode not in ('free', 'host') then
    raise exception 'control_mode inválido' using errcode = '22023';
  end if;
  insert into public.rooms (code, host_id, control_mode)
  values (p_code, p_device_id, p_control_mode)
  returning * into v_room;
  return v_room;
exception when unique_violation then
  raise exception 'Código de sala ocupado' using errcode = 'P0001';
end $$;

create or replace function public.get_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  select * into v_room from public.rooms where code = p_code;
  if not found then
    raise exception 'Esa sala no existe o ya se cerró' using errcode = 'P0002';
  end if;
  return v_room;
end $$;

create or replace function public.update_room(
  p_code text,
  p_device_id text,
  p_media jsonb,
  p_position double precision,
  p_is_playing boolean,
  p_sent_at_global bigint
) returns void
language plpgsql security definer set search_path = public as $$
declare v_room public.rooms;
begin
  perform public.assert_room_code(p_code);
  select * into v_room from public.rooms where code = p_code for update;
  if not found then
    raise exception 'Esa sala no existe o ya se cerró' using errcode = 'P0002';
  end if;
  if v_room.control_mode = 'host' and v_room.host_id <> p_device_id then
    raise exception 'Solo el anfitrión controla esta sala' using errcode = '42501';
  end if;
  -- Una posición publicada sin su ancla temporal es inutilizable: se rechaza.
  if p_position is not null and p_sent_at_global is null then
    raise exception 'position requiere sent_at_global' using errcode = '22023';
  end if;
  if p_position is not null and p_position < 0 then
    raise exception 'position negativa' using errcode = '22023';
  end if;
  if p_media is not null then
    if coalesce(p_media->>'kind', '') not in ('file', 'url', 'youtube') then
      raise exception 'media.kind inválido' using errcode = '22023';
    end if;
    if length(coalesce(p_media->>'title', '')) > 300 then
      raise exception 'media.title demasiado largo' using errcode = '22023';
    end if;
    if p_media->>'kind' = 'youtube' then
      if coalesce(p_media->>'src', '') !~ '^[A-Za-z0-9_-]{11}$' then
        raise exception 'media.src debe ser un videoId de YouTube' using errcode = '22023';
      end if;
      if p_media->'mirror' is not null then
        raise exception 'media.mirror solo aplica a kind=file' using errcode = '22023';
      end if;
    elsif p_media->>'kind' = 'url' then
      if coalesce(p_media->>'src', '') !~ '^https?://' or length(p_media->>'src') > 2048 then
        raise exception 'media.src debe ser una URL http(s)' using errcode = '22023';
      end if;
      if p_media->'mirror' is not null then
        raise exception 'media.mirror solo aplica a kind=file' using errcode = '22023';
      end if;
    else
      -- kind = 'file': el src es un blob local de cada dispositivo y nunca se persiste.
      if p_media->>'src' is not null
         or coalesce(p_media->'mirror'->>'name', '') = ''
         or coalesce((p_media->'mirror'->>'size')::bigint, 0) <= 0 then
        raise exception 'media de archivo inválido' using errcode = '22023';
      end if;
    end if;
  end if;
  update public.rooms set
    media = coalesce(p_media, media),
    position = coalesce(p_position, position),
    is_playing = coalesce(p_is_playing, is_playing),
    sent_at_global = coalesce(p_sent_at_global, sent_at_global),
    updated_at = now()
  where code = p_code;
end $$;

create or replace function public.set_control_mode(
  p_code text, p_device_id text, p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_room_code(p_code);
  if p_mode not in ('free', 'host') then
    raise exception 'control_mode inválido' using errcode = '22023';
  end if;
  update public.rooms set
    control_mode = p_mode,
    host_id = case when p_mode = 'host' then p_device_id else host_id end,
    updated_at = now()
  where code = p_code and (control_mode = 'free' or host_id = p_device_id);
  if not found then
    raise exception 'Solo el anfitrión cambia los permisos' using errcode = '42501';
  end if;
end $$;

create or replace function public.claim_host(p_code text, p_device_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_room_code(p_code);
  update public.rooms set host_id = p_device_id, updated_at = now()
  where code = p_code and control_mode = 'host';
  if not found then
    raise exception 'La sala no está en modo anfitrión' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.purge_stale_rooms(p_days integer default 2)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days debe ser >= 1' using errcode = '22023';
  end if;
  -- Nunca por created_at: una sala vieja puede estar en uso ahora mismo.
  -- Solo salas con actividad caducada y en pausa: si está reproduciendo, hay oyentes
  -- aunque no haya escrituras recientes (updated_at no se refresca solo por reproducir).
  delete from public.rooms
  where updated_at < now() - make_interval(days => p_days)
    and is_playing = false;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- Sin grant: purge_stale_rooms borra filas, así que no se expone a anon.
-- Se ejecuta desde el SQL Editor (rol propietario) o con service_role.

grant execute on function public.create_room(text, text, text) to anon;
grant execute on function public.get_room(text) to anon;
grant execute on function public.update_room(text, text, jsonb, double precision, boolean, bigint) to anon;
grant execute on function public.set_control_mode(text, text, text) to anon;
grant execute on function public.claim_host(text, text) to anon;
```

Las RPC son `security definer` y pertenecen al rol que ejecuta el script (`postgres`, el del SQL Editor). Ese rol es el propietario de la tabla, así que RLS no le aplica: por eso las funciones funcionan con `rooms` completamente cerrada. No añadas `force row level security` sin escribir antes políticas que permitan leer y escribir al propietario, o las RPC dejan de servir.

`media` es `null` mientras la sala no tiene fuente elegida, y después:

```json
{
  "kind": "url" | "youtube" | "file",
  "src": "https://… o el videoId de 11 caracteres",
  "title": "texto visible",
  "duration": 0,
  "mirror": { "name": "peli.mp4", "size": 734003200 }
}
```

Reglas del objeto: `src` es obligatorio en `kind: 'url'` y `kind: 'youtube'`, y **siempre `null` en `kind: 'file'`** (el archivo es un `blob:` local de cada dispositivo, no se persiste ni se transmite); en ese modo la identidad compartida es `mirror.name` + `mirror.size` + `duration`, que cada dispositivo compara contra su propio archivo. `mirror` solo existe en `kind: 'file'`; la RPC rechaza el resto de combinaciones. `updated_at` solo sirve para la limpieza de salas inactivas (`purge_stale_rooms`) y como dato de auditoría: **no** es base temporal de nada.

No hace falta activar Postgres Changes ni añadir la tabla a la publicación de Realtime: el estado instantáneo viaja por Broadcast y la tabla solo se lee al entrar.

---

## 5. INTERFAZ (dark mode premium)

1. **Lobby:** fondo `bg-slate-950`, acentos violeta/esmeralda, glassmorphism. Alias guardado en `localStorage`. Botón **"Crear Sala Sincronizada"** (genera código, actualiza la URL a `?room=SYNC84` con `history.replaceState`) e input **"Unirse con Código"**. Si la URL trae `?room=`, autorrellena y enfoca el botón de unirse.
2. **Cabecera de sala:** ping (`Ping: 18 ms`), precisión del reloj (`±12 ms`), estado (`Sincronizado` verde / `Ajustando velocidad…` ámbar / `Reloj degradado` rojo), contador de dispositivos desde `presenceState()`. Botón **"Invitar / QR"**: modal con el enlace directo, `navigator.share` si existe, copiar al portapapeles y un QR generado en canvas en el cliente (usa `qrcode` en modo render a canvas; no llames a ninguna API externa). Selector de permisos: "Control libre" vs "Modo Anfitrión".
3. **Selector de fuente (3 modos):**
   - **URL directa:** `.mp4`, `.webm`, `.mp3`, `.wav`, `.ogg`, con 3 demos precargadas y botón de un clic.
   - **YouTube:** pega el enlace, extrae el `videoId`, monta el IFrame Player API.
   - **Archivo local espejo:** `<input type="file">` en cada dispositivo; comprueba que `name` (normalizado, sin extensión, minúsculas), `size` (±2 %) y `duration` (±1 s) coincidan antes de permitir sincronizar. Si no coinciden, muestra la discrepancia exacta. El `blob:` de `URL.createObjectURL` nunca sale del dispositivo: en `rooms` se publica `media = { kind: 'file', src: null, title, duration, mirror: { name, size } }`, y esa es la identidad contra la que cada dispositivo compara el suyo. Revoca el objeto con `URL.revokeObjectURL` al cambiar de archivo y al desmontar.
4. **Reproductor:** controles propios (play/pausa sincronizado, barra de progreso con previsualización de tiempo, volumen **local** por dispositivo, pantalla completa), **slider de calibración fina −200 ms a +200 ms** (compensa el retardo del Bluetooth local sin afectar a los demás; persiste en `localStorage`), botón **"Re-sincronizar ahora"** (recalibra reloj + hard seek) y **chat/reacciones flotantes** (emojis que suben por pantalla, sin interrumpir el video, animación con `prefers-reduced-motion` respetado).

---

## 6. ESTRUCTURA DEL PROYECTO

```text
/
├── vercel.json
├── package.json                  # solo scripts raíz (dev, build, deploy)
├── README.md
├── supabase/
│   └── schema.sql
├── api/
│   └── time.js                   # función serverless: { t: Date.now() }
├── client/
│   ├── package.json
│   ├── .env.example              # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
│   ├── vite.config.js            # VitePWA + manifest + proxy /api en dev
│   ├── tailwind.config.js        # content: index.html + src/**/*.{js,jsx}
│   ├── postcss.config.js         # tailwindcss + autoprefixer
│   ├── index.html
│   ├── public/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── icon-maskable-512.png
│   └── src/
│       ├── main.jsx              # importa ./index.css
│       ├── index.css             # @tailwind base / components / utilities
│       ├── App.jsx
│       ├── lib/
│       │   ├── supabase.js       # cliente con URL y anon key de env
│       │   ├── syncAdapter.js    # interfaz única: join/leave/send/on/state
│       │   ├── playerAdapter.js  # contrato de reproductor (3.C.1): nativo y YouTube
│       │   └── constants.js      # umbrales, alfabeto de códigos, eventos
│       ├── hooks/
│       │   ├── useClockSync.js
│       │   ├── useWakeLock.js
│       │   ├── useSyncRoom.js
│       │   └── useDriftCorrection.js
│       └── components/
│           ├── Lobby.jsx
│           ├── RoomHeader.jsx
│           ├── SyncPlayer.jsx
│           ├── MediaSelector.jsx
│           ├── YouTubePlayer.jsx
│           ├── InviteModal.jsx
│           ├── TapToSyncOverlay.jsx
│           ├── ChatPanel.jsx
│           └── Reactions.jsx
```

`syncAdapter.js` es obligatorio y es la razón de que esto sea mantenible: expone una interfaz neutra (`joinRoom`, `leaveRoom`, `sendControl`, `sendReaction`, `getSnapshot`, `subscribe`) y la implementación concreta es Supabase Realtime. Si mañana quieres cambiar de transporte, solo se reescribe ese archivo. `playerAdapter.js` cumple el mismo papel del lado del reproductor (3.C.1): el bucle de deriva no sabe si enfrente hay un `<video>` o un iframe de YouTube, así que añadir un reproductor nuevo no toca la lógica de sincronización.

---

## 7. PWA Y SERVICE WORKER (detalles que rompen la sincronización si se ignoran)

- `registerType: 'autoUpdate'`, `injectRegister: 'auto'`, `devOptions: { enabled: false }`.
- `manifest`: `name: "SyncWave"`, `short_name: "SyncWave"`, `display: "standalone"`, `orientation: "any"`, `theme_color` `#0f172a`, `background_color` `#020617`, `start_url: "/"` y el array `icons` completo: `{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }`, el mismo de 512 y `{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }`. Sin `sizes` y `type` explícitos el navegador puede descartar el icono y la PWA se instala sin logo.
- **Iconos reales, no renombrados.** Los tres son PNG con fondo opaco: un SVG con extensión `.png`, o un PNG transparente, rompe la instalación en Android. En el maskable el logo ocupa solo el 80 % central (zona segura), porque el sistema recorta el resto en círculo o squircle. Añade además `<link rel="apple-touch-icon" href="/icon-192.png">` y `<meta name="theme-color" content="#0f172a">` en `index.html`, o iOS instala un icono en blanco.
- **`/api/time` jamás se cachea.** Configura `workbox.navigateFallbackDenylist: [/^\/api\//]` y una ruta `runtimeCaching` para `/^\/api\/time/` con `NetworkOnly`. Un endpoint de reloj cacheado devuelve una hora vieja y la sincronización se va al suelo sin dar ningún error visible: es el fallo más difícil de diagnosticar de todo el proyecto.
- `navigateFallback: '/index.html'` para que `?room=CODE` funcione al recargar.
- `workbox.globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`.
- Registra `Media Session` con `setActionHandler` para play/pause/seek y metadatos (título del medio) solo en modo audio, y libera el WakeLock al pausar y al desmontar el componente. El ciclo completo está en 3.H: cada acción emite por el adapter (no se aplica en local) y el Wake Lock se vuelve a pedir al volver a `visible`.

---

## 8. DESPLIEGUE

`vercel.json` en la raíz:

```json
{
  "buildCommand": "npm --prefix client ci && npm --prefix client run build",
  "outputDirectory": "client/dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
```

`package.json` de la raíz: solo scripts que delegan, porque la app vive en `client/`. Así `npm ci` y `npm run build` funcionan desde la raíz y hacen lo mismo que el `buildCommand`:

```json
{
  "private": true,
  "scripts": {
    "dev": "npm --prefix client run dev -- --host",
    "build": "npm --prefix client ci && npm --prefix client run build",
    "deploy": "vercel --prod"
  }
}
```

Variables de entorno (Vercel → Settings → Environment Variables, y `client/.env.local` en local):

```text
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key pública>
```

`client/.env.example` incluido, sin valores reales: cópialo a `client/.env.local` (Vite lee el `.env` del directorio del proyecto, no el de la raíz). Añade `client/.env.local` y `.env` al `.gitignore`.

`npm ci` exige que `client/package-lock.json` esté commiteado y sincronizado con `client/package.json`: es lo que garantiza que Vercel instale exactamente las versiones que probaste en local. Un `npm install` en el build reescribe el lockfile y puede desplegar dependencias distintas a las de tu máquina, justo el tipo de diferencia que hace que la app funcione en local y falle en producción. Si el lock falta o no coincide, el build falla en vez de resolver versiones nuevas: es lo correcto, arregla el lock, no lo borres.

**Caveat obligatorio en el README:** `navigator.wakeLock`, la instalación como PWA y el Service Worker **solo funcionan en `https://` o en `localhost`**. Probar desde un móvil contra `http://192.168.x.x:5173` no permite instalar la PWA ni mantener la pantalla encendida; para una prueba real con dos teléfonos, usa el despliegue de Vercel (que ya trae HTTPS) o un túnel HTTPS.

---

## 9. VERIFICACIÓN OBLIGATORIA ANTES DE ENTREGAR

Ejecuta y comprueba, y reporta el resultado de cada punto:

1. Dos pestañas en el mismo equipo: se ven en el contador de presencia, y play/pausa/seek de una se refleja en la otra sin eco ni rebote.
2. Recarga en la segunda pestaña con reproducción en curso: el overlay "Toca para sincronizar" aparece y tras el toque queda alineada.
3. Simula desfase: en la pestaña B ejecuta `document.querySelector('video').currentTime -= 0.4` y comprueba que vuelve alineada ajustando `playbackRate` (consola: drift en ms, sin saltos).
4. Desfase grande: `-= 3` y comprueba el hard seek único.
5. Desconexión: activa modo avión / DevTools offline, espera 10 s, vuelve: el reloj se recalibra y el estado se relee de `rooms`.
6. Archivo local: mismo archivo en ambos lados sincroniza; archivo distinto muestra el aviso de discrepancia y no permite sincronizar.
7. Modo Host: un segundo dispositivo no ve los controles y sus intentos no alteran la sala.
8. `npm ci && npm run build` desde la raíz, sin errores; manifest y service worker servidos correctamente en producción (`vite preview` o el despliegue de Vercel) y los tres iconos responden 200 con el tamaño que declaran.
9. **Permisos cerrados:** con la anon key, `supabase.from('rooms').select('*')` y `rpc('purge_stale_rooms')` fallan por permisos (no devuelven `[]` ni `0`). `get_room('abc')` rechaza por formato y `get_room('ZZZZZZ')` responde "Esa sala no existe o ya se cerró". Con `control_mode = 'host'`, `update_room` de otro `deviceId` devuelve "Solo el anfitrión controla esta sala".
10. **Sin restos:** `grep -r "TODO\|FIXME\|implementar" client/src api` vacío, y ninguna clase de Tailwind usada en los componentes falta en el CSS compilado (compruébalo en el HTML servido, no solo que compile).

---

## 10. ENTREGA

1. Todos los archivos de la estructura, completos.
2. `README.md` con: qué es, cómo crear el proyecto de Supabase, dónde ejecutar `supabase/schema.sql`, variables de entorno, y los comandos exactos:

```bash
# 1. dependencias (reproducible: exige client/package-lock.json commiteado)
cd client && npm ci

# 2. desarrollo (dos terminales)
npx vercel dev --listen 3000          # sirve /api/time
cd client && npm run dev -- --host    # PWA en http://localhost:5173 (proxy /api → 3000)

# 3. producción
npx vercel --prod

# 4. limpieza de salas inactivas (opcional, en el SQL editor de Supabase)
select public.purge_stale_rooms(2);  -- borra solo salas en pausa sin actividad en 2 días
```

3. Sección "Limitaciones conocidas y honestas" en el README: el modo YouTube solo alcanza sincronización aproximada (±300 ms) porque la IFrame API no permite `playbackRate` ni control fino de posición; el modo Host es cortesía y no seguridad; el reloj depende de un endpoint serverless y con red mala puede tardar en estabilizarse.
