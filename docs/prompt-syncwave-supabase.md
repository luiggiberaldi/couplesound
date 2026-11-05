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

- **Frontend:** React 18 + Vite, Tailwind CSS, Lucide React (iconos), `@supabase/supabase-js` v2.
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
| **Snapshot duradero** | tabla `rooms` en Postgres | Qué se está reproduciendo, dónde y desde cuándo. Es la verdad que sobrevive a desconexiones. | ~100 ms (lectura al entrar) |
| **Eventos instantáneos** | Supabase Broadcast | "Play", "Pause", "Seek", "Cambio de medio", "Emoji". Llega a los conectados al instante. | ~20–80 ms |
| **Presencia** | Supabase Presence | Lista de dispositivos, alias, rol y contador en vivo. | ~1 s |
| **Reloj** | `GET /api/time` en Vercel | Única referencia temporal común. Devuelve `{ t: Date.now() }`. | medido |

**Regla de oro:** el reproductor de cada dispositivo **nunca** espera órdenes continuas del servidor. Recibe un evento puntual con `{ position, isPlaying, sentAtGlobal }`, se alinea una vez y a partir de ahí corrige por su cuenta contra el reloj global. Si el canal se cae, la reproducción no se detiene; solo deja de recibir órdenes nuevas.

**Quién escribe el estado:** con `control_mode = 'free'` cualquier dispositivo puede actuar; con `'host'` solo el creador (bloqueo de cortesía, ver 3.F). En ambos casos, el dispositivo que ejecuta la acción hace dos cosas en paralelo: (a) emite el Broadcast inmediato y (b) hace un `upsert` del estado en `rooms` con debounce de 250 ms.

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
8. Expón `getGlobalNow()` que devuelve `Date.now() + clockOffset`, y `accuracy` (la mitad del rango intercuartílico de las muestras usadas) para mostrarla en la UI.
9. Si las 5 muestras fallan (offline, función caída), marca estado `degraded`: la app sigue funcionando con offset 0 y lo avisa en la cabecera. Nunca bloquees la sala por no tener reloj.

Toda orden de reproducción se expresa en **Reloj Maestro Global**: `globalNow = Date.now() + clockOffset`. Los eventos enviados llevan `sentAtGlobal`; el receptor calcula `target = position + (globalNow - sentAtGlobal) / 1000`. No uses `updated_at` de Postgres para esto: tiene resolución y desfase de servidor distintos; `updated_at` sirve solo para el snapshot inicial.

### B. Estado de sala sin memoria de servidor

No puedes tener `roomState` en un objeto Node: desaparece. El flujo correcto es:

- **Al crear la sala:** genera un código de 6 caracteres con alfabeto sin ambigüedad (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, sin `O`, `0`, `I`, `1`), inserta la fila en `rooms` y reintenta hasta 5 veces si el `code` ya existe (violación de PK). Nada de códigos aleatorios sin comprobar colisión.
- **Al entrar:** lee la fila con `select` por `code`. Si no existe, error claro ("Esa sala no existe o ya se cerró"). Simultáneamente suscríbete al canal y haz `track()` de presencia.
- **Al actuar:** Broadcast + `upsert` en `rooms` con `{ media, position, is_playing, host_id, control_mode, updated_at: new Date().toISOString() }`, debounced 250 ms, y siempre la última acción gana (last-write-wins). Cada evento lleva un `controlId` (uuid) para que puedas ordenar acciones simultáneas y descartar las que llegan tarde.
- **Al salir:** `untrack()` y `removeChannel`. No borres la fila al salir del primer dispositivo: la sala debe sobrevivir a una recarga.

### C. Corrección de desfase suave (soft vs. hard drift)

Saltar con `media.currentTime = target` produce un corte audible. Bucle de monitoreo **local** cada 500 ms, **que no publica nada al canal** (solo compara):

- `expectedPosition = roomState.position + ((globalNow - roomState.sentAtGlobal) / 1000)` cuando está reproduciendo.
- `drift = media.currentTime - expectedPosition`, **más** el offset manual del dispositivo (sección 5): `drift += manualOffsetMs / 1000`.
- **|drift| < 0.025 s:** `playbackRate = 1.0`. Sin cambios.
- **0.025 s ≤ |drift| ≤ 0.800 s:** ajuste elástico, sin cortes. Si va atrasado (`drift < 0`), `playbackRate = 1.05`; si va adelantado (`drift > 0`), `playbackRate = 0.95`. Aplica **histéresis**: no vuelvas a `1.0` hasta que `|drift| < 0.015 s` durante 2 ciclos consecutivos, o el reproductor oscilará entre 0.95 y 1.05 produciendo un vibrato audible.
- **|drift| > 0.800 s:** *hard seek* a `expectedPosition` y `playbackRate = 1.0`.
- Si el elemento está pausado, el bucle no corrige: solo compara al reanudar.
- Si `expectedPosition` supera la duración del medio, fija el final y marca pausado localmente.

### D. Desbloqueo de autoplay en móviles (iOS Safari / Chrome Android)

Ningún `.play()` con sonido funciona sin gesto previo del usuario. Si un invitado entra a una sala ya en reproducción:

- Muestra un overlay Glassmorphism centrado: **"Toca para sincronizar audio y video en vivo"**.
- Al tocar: crea y reanuda un `AudioContext` (aunque no lo uses para nada audible: desbloquea la pila de audio en iOS), llama a `media.play()`, solicita el `WakeLock`, hace un seek inmediato al instante actual y oculta el overlay.
- Si la sala está en pausa, el overlay aparece igual pero el toque solo prepara el reproductor.
- En ningún caso intentes autoplay silencioso con `muted` + luego desmutear sin gesto: en iOS el video se queda pausado y en Android el usuario no oye nada.

### E. Prevención de ecos y duplicados

- Configura el canal con `broadcast: { self: false }`: Supabase no reenvía el mensaje a quien lo emite.
- Añade igualmente `isRemoteActionRef.current = true` cada vez que el reproductor cambie por una orden remota, e ignora los eventos nativos `onPlay`, `onPause`, `onSeeked` durante 150 ms, para que el receptor no re-emita la acción recibida.
- Descarta eventos con un `id` ya visto (set acotado a los últimos 200 ids) y eventos cuyo `controlId` sea anterior al último aplicado.
- Al aplicar una orden remota, pausa tu propio bucle de deriva durante 300 ms para que no compita con el seek.

### F. Seguridad realista (no simules lo que no tienes)

- La `anon key` de Supabase es pública por diseño: va en el bundle y está bien. La `service_role` **nunca** aparece en el cliente ni en `VITE_*`.
- Con canales públicos, cualquiera con el código de la sala puede emitir y leer. **Modo Host es un bloqueo de cortesía**, no seguridad: se aplica en el cliente, ocultando controles y rechazando acciones de quien no sea `host_id`. Documéntalo tal cual en el README, sin prometer protección.
- Opcional y bien separado: deja preparado el interruptor `VITE_PRIVATE_ROOMS=true` que cree los canales con `config: { private: true }` y documento el SQL de políticas RLS sobre `realtime.messages`. Si no está activo, los canales son públicos.
- Valida el formato del código de sala antes de consultar (regex `^[A-Z2-9]{6}$`) y valida las URLs de medios (solo `http`/`https`, sin `javascript:`).

### G. Límites de Supabase Realtime y Vercel

- No conviertas el canal en un bus de alta frecuencia. **Solo eventos discretos** (play, pause, seek, cambio de medio, emoji, chat). El bucle de deriva y las calibraciones de reloj no publican nada salvo el evento explícito "Re-sincronizar".
- Un `seek` mientras se arrastra la barra: emite un solo evento al soltar (`onPointerUp`), no en cada movimiento.
- El canal se re-suscribe solo tras una desconexión (`supabase.realtime.onError`, `visibilitychange`); al reconectar, recalibra reloj, vuelve a leer el snapshot de `rooms` y haz `untrack` limpio de la presencia anterior.
- No abras un canal por cada cambio de medio: reutiliza `room:<code>` durante toda la sesión.

---

## 4. MODELO DE DATOS (SQL exacto, inclúyelo en `supabase/schema.sql`)

```sql
create table if not exists public.rooms (
  code         text primary key,
  media         jsonb not null,
  position      double precision not null default 0,
  is_playing    boolean not null default false,
  host_id       text,
  control_mode  text not null default 'free' check (control_mode in ('free','host')),
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- v1: cualquiera con el código puede leer y actualizar su sala.
-- El código de 6 caracteres con alfabeto de 32 símbolos es el control de acceso.
create policy rooms_read   on public.rooms for select to anon using (true);
create policy rooms_insert on public.rooms for insert to anon with check (true);
create policy rooms_update on public.rooms for update to anon using (true) with check (true);
```

`media` es un objeto `{ kind: 'file' | 'url' | 'youtube', src: string, title: string, duration: number, mirror?: { name: string, size: number } }`.

No hace falta activar Postgres Changes ni añadir la tabla a la publicación de Realtime: el estado instantáneo viaja por Broadcast y la tabla solo se lee al entrar.

---

## 5. INTERFAZ (dark mode premium)

1. **Lobby:** fondo `bg-slate-950`, acentos violeta/esmeralda, glassmorphism. Alias guardado en `localStorage`. Botón **"Crear Sala Sincronizada"** (genera código, actualiza la URL a `?room=SYNC84` con `history.replaceState`) e input **"Unirse con Código"**. Si la URL trae `?room=`, autorrellena y enfoca el botón de unirse.
2. **Cabecera de sala:** ping (`Ping: 18 ms`), precisión del reloj (`±12 ms`), estado (`Sincronizado` verde / `Ajustando velocidad…` ámbar / `Reloj degradado` rojo), contador de dispositivos desde `presenceState()`. Botón **"Invitar / QR"**: modal con el enlace directo, `navigator.share` si existe, copiar al portapapeles y un QR generado en canvas en el cliente (usa `qrcode` en modo render a canvas; no llames a ninguna API externa). Selector de permisos: "Control libre" vs "Modo Anfitrión".
3. **Selector de fuente (3 modos):**
   - **URL directa:** `.mp4`, `.webm`, `.mp3`, `.wav`, `.ogg`, con 3 demos precargadas y botón de un clic.
   - **YouTube:** pega el enlace, extrae el `videoId`, monta el IFrame Player API.
   - **Archivo local espejo:** `<input type="file">` en cada dispositivo; comprueba que `name` (normalizado, sin extensión, minúsculas), `size` (±2 %) y `duration` (±1 s) coincidan antes de permitir sincronizar. Si no coinciden, muestra la discrepancia exacta. El objeto `URL.createObjectURL` nunca sale del dispositivo.
4. **Reproductor:** controles propios (play/pausa sincronizado, barra de progreso con previsualización de tiempo, volumen **local** por dispositivo, pantalla completa), **slider de calibración fina −200 ms a +200 ms** (compensa el retardo del Bluetooth local sin afectar a los demás; persiste en `localStorage`), botón **"Re-sincronizar ahora"** (recalibra reloj + hard seek) y **chat/reacciones flotantes** (emojis que suben por pantalla, sin interrumpir el video, animación con `prefers-reduced-motion` respetado).

---

## 6. ESTRUCTURA DEL PROYECTO

```text
/
├── vercel.json
├── package.json                  # solo scripts raíz (dev, build, deploy)
├── .env.example
├── README.md
├── supabase/
│   └── schema.sql
├── api/
│   └── time.js                   # función serverless: { t: Date.now() }
├── client/
│   ├── package.json
│   ├── vite.config.js            # VitePWA + manifest + proxy /api en dev
│   ├── index.html
│   ├── public/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── icon-maskable-512.png
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── lib/
│       │   ├── supabase.js       # cliente con URL y anon key de env
│       │   ├── syncAdapter.js    # interfaz única: join/leave/send/on/state
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
│           └── Reactions.jsx
```

`syncAdapter.js` es obligatorio y es la razón de que esto sea mantenible: expone una interfaz neutra (`joinRoom`, `leaveRoom`, `sendControl`, `sendReaction`, `getSnapshot`, `subscribe`) y la implementación concreta es Supabase Realtime. Si mañana quieres cambiar de transporte, solo se reescribe ese archivo.

---

## 7. PWA Y SERVICE WORKER (detalles que rompen la sincronización si se ignoran)

- `registerType: 'autoUpdate'`, `injectRegister: 'auto'`, `devOptions: { enabled: false }`.
- `manifest`: `name: "SyncWave"`, `short_name: "SyncWave"`, `display: "standalone"`, `orientation: "any"`, `theme_color` `#0f172a`, `background_color` `#020617`, `start_url: "/"`, iconos 192/512 y maskable.
- **`/api/time` jamás se cachea.** Configura `workbox.navigateFallbackDenylist: [/^\/api\//]` y una ruta `runtimeCaching` para `/^\/api\/time/` con `NetworkOnly`. Un endpoint de reloj cacheado devuelve una hora vieja y la sincronización se va al suelo sin dar ningún error visible: es el fallo más difícil de diagnosticar de todo el proyecto.
- `navigateFallback: '/index.html'` para que `?room=CODE` funcione al recargar.
- `workbox.globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`.
- Registra `Media Session` con `setActionHandler` para play/pause/seek y metadatos (título del medio) solo en modo audio, y libera el WakeLock al pausar y al desmontar el componente.

---

## 8. DESPLIEGUE

`vercel.json` en la raíz:

```json
{
  "buildCommand": "npm --prefix client install && npm --prefix client run build",
  "outputDirectory": "client/dist",
  "rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
}
```

Variables de entorno (Vercel → Settings → Environment Variables, y `client/.env.local` en local):

```text
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key pública>
```

`.env.example` incluido, sin valores reales. Añade `client/.env.local` y `.env` al `.gitignore`.

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
8. `npm run build` sin errores; manifest y service worker servidos correctamente en producción (`vercel build` o `vite preview`).

---

## 10. ENTREGA

1. Todos los archivos de la estructura, completos.
2. `README.md` con: qué es, cómo crear el proyecto de Supabase, dónde ejecutar `supabase/schema.sql`, variables de entorno, y los comandos exactos:

```bash
# 1. dependencias
cd client && npm install

# 2. desarrollo (dos terminales)
npx vercel dev --listen 3000          # sirve /api/time
cd client && npm run dev -- --host    # PWA en http://localhost:5173 (proxy /api → 3000)

# 3. producción
npx vercel --prod

# 4. limpieza manual de salas viejas (opcional, en el SQL editor de Supabase)
delete from public.rooms where created_at < now() - interval '2 days';
```

3. Sección "Limitaciones conocidas y honestas" en el README: el modo YouTube solo alcanza sincronización aproximada (±300 ms) porque la IFrame API no permite `playbackRate` ni control fino de posición; el modo Host es cortesía y no seguridad; el reloj depende de un endpoint serverless y con red mala puede tardar en estabilizarse.
