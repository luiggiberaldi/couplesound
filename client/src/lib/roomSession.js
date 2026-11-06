import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  CONTROL_MODES,
  DEDUPE_LIMIT,
  HOST_CLAIM_TIMEOUT_MS,
  HOST_WATCH_INTERVAL_MS,
  MAX_ROOM_CREATE_ATTEMPTS,
  REACTION_MIN_INTERVAL_MS,
  REACTION_TTL_MS,
  REMOTE_PAUSE_MS,
  SAVE_DEBOUNCE_MS
} from './constants.js';
import { createEventOrder } from './order.js';
import { createRateLimiter, normalizeChatText } from './rateLimit.js';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './roomCode.js';

export function toRoom(row) {
  return {
    code: row.code,
    media: row.media ?? null,
    position: Number(row.position) || 0,
    isPlaying: Boolean(row.is_playing),
    sentAtGlobal: row.sent_at_global === null ? null : Number(row.sent_at_global),
    hostId: row.host_id,
    controlMode: row.control_mode
  };
}

export function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('Código de sala ocupado')) return 'Ese código ya está en uso, prueba otra vez.';
  if (message.includes('no existe o ya se cerró')) return 'Esa sala no existe o ya se cerró.';
  if (message.includes('Código de sala inválido')) return 'El código tiene que ser de 6 caracteres válidos.';
  if (message.includes('Solo el anfitrión')) return 'Solo el anfitrión controla esta sala.';
  if (message.includes('La sala no está en modo anfitrión')) return 'La sala no está en modo anfitrión.';
  if (message.toLowerCase().includes('failed to fetch')) return 'Sin conexión con Supabase.';
  return message || 'Algo ha ido mal.';
}

function compareByJoinedAt(a, b) {
  if (a.joinedAt === b.joinedAt) return a.deviceId < b.deviceId ? -1 : 1;
  return a.joinedAt < b.joinedAt ? -1 : 1;
}

/**
 * Estado y reglas de una sala (3.B, 3.E, 3.G) sin React: recibe el adaptador, el
 * reloj y los temporizadores por inyección, así que se puede probar con un doble
 * de Supabase y un reloj falso.
 */
export function createRoomSession({
  createAdapter,
  deviceId,
  getAlias,
  getGlobalNow = () => Date.now(),
  now = () => Date.now(),
  setTimer,
  clearTimer,
  startInterval,
  stopInterval,
  pauseRef = { current: 0 },
  onChange = () => {}
}) {
  if (typeof createAdapter !== 'function') throw new Error('createAdapter es obligatorio');
  if (!setTimer || !clearTimer || !startInterval || !stopInterval) {
    throw new Error('Faltan los temporizadores');
  }

  const order = createEventOrder({ dedupeLimit: DEDUPE_LIMIT });
  const chatLimiter = createRateLimiter({ minIntervalMs: CHAT_MIN_INTERVAL_MS, now });
  const reactionLimiter = createRateLimiter({ minIntervalMs: REACTION_MIN_INTERVAL_MS, now });

  let adapter = null;
  let room = null;
  let session = null;
  let devices = [];
  let status = 'idle';
  let error = null;
  let chatMessages = [];
  let reactions = [];
  let lastControlAt = 0;
  let lastWriter = '';
  let saveTimer = null;
  let hostWatch = null;
  let hostMissingSince = null;

  const reactionTimers = new Set();

  function state() {
    return { session, room, devices, status, error, chatMessages, reactions, lastControlAt };
  }

  function emit() {
    onChange(state());
  }

  function setError(message) {
    error = message;
    emit();
  }

  function clearError() {
    error = null;
    emit();
  }

  function canControl() {
    if (!room) return false;
    if (room.controlMode !== CONTROL_MODES.HOST) return true;
    return room.hostId === deviceId;
  }

  function scheduleSave(next) {
    if (saveTimer !== null) clearTimer(saveTimer);
    saveTimer = setTimer(async () => {
      saveTimer = null;
      try {
        await adapter?.saveState({
          media: next.media,
          position: next.position,
          isPlaying: next.isPlaying,
          sentAtGlobal: next.sentAtGlobal
        });
      } catch (saveError) {
        // En modo host, un dispositivo sin permiso no debe romper la UI.
        console.warn('No se pudo guardar el snapshot:', friendlyError(saveError));
      }
    }, SAVE_DEBOUNCE_MS);
  }

  async function emitControl({ type, media = null, position, isPlaying }) {
    if (!room) return;
    if (!canControl()) {
      setError('Solo el anfitrión controla esta sala.');
      return;
    }

    const sentAtGlobal = getGlobalNow();
    const next = {
      ...room,
      media: media ?? room.media,
      position,
      isPlaying,
      sentAtGlobal
    };

    lastWriter = deviceId;
    pauseRef.current = now() + REMOTE_PAUSE_MS;
    room = next;
    lastControlAt = now();
    emit();
    scheduleSave(next);

    try {
      await adapter?.sendControl({
        type,
        media: next.media,
        position,
        isPlaying,
        sentAtGlobal
      });
    } catch (sendError) {
      setError(friendlyError(sendError));
    }
  }

  function applyRemoteControl(envelope) {
    if (!envelope || envelope.deviceId === deviceId) return;
    if (!order.register(envelope)) return;
    if (!order.isNewer(envelope, room, lastWriter)) return;
    if (!room) return;

    lastWriter = envelope.deviceId;
    pauseRef.current = now() + REMOTE_PAUSE_MS;
    room = {
      ...room,
      media: envelope.media ?? room.media,
      position: Number(envelope.position) || 0,
      isPlaying: Boolean(envelope.isPlaying),
      sentAtGlobal: Number(envelope.sentAtGlobal)
    };
    lastControlAt = now();
    emit();
  }

  function addReaction(reaction) {
    reactions = [...reactions, reaction];
    emit();
    const timer = setTimer(() => {
      reactionTimers.delete(timer);
      reactions = reactions.filter((item) => item.id !== reaction.id);
      emit();
    }, REACTION_TTL_MS);
    reactionTimers.add(timer);
  }

  async function sendReaction(emoji) {
    const at = now();
    // Ráfaga agrupada: como máximo un evento cada 150 ms por dispositivo.
    if (!reactionLimiter.consume(at)) return false;

    const reaction = { id: `reaction-${at}-${emoji}`, emoji, alias: getAlias() || 'Invitado', at };
    addReaction(reaction);
    try {
      await adapter?.sendReaction({ emoji, alias: reaction.alias, sentAtGlobal: getGlobalNow() });
    } catch (sendError) {
      setError(friendlyError(sendError));
    }
    return true;
  }

  async function sendChat(text) {
    const clean = normalizeChatText(text, CHAT_MAX_LENGTH);
    if (!clean) return { ok: false, reason: 'vacío' };

    const at = now();
    if (!chatLimiter.consume(at)) return { ok: false, reason: 'espera' };

    const message = { id: `chat-${at}-${chatMessages.length}`, alias: getAlias() || 'Invitado', text: clean, at };
    chatMessages = [...chatMessages, message].slice(-CHAT_HISTORY_LIMIT);
    emit();

    try {
      await adapter?.sendChat({ text: clean, alias: message.alias });
    } catch (sendError) {
      setError(friendlyError(sendError));
    }
    return { ok: true };
  }

  async function claimHost() {
    if (!room || !adapter) return;
    try {
      await adapter.claimHost(room.code, deviceId);
      lastWriter = deviceId;
      room = { ...room, hostId: deviceId, controlMode: CONTROL_MODES.HOST };
      emit();
    } catch (claimError) {
      setError(friendlyError(claimError));
    }
  }

  async function setControlMode(mode) {
    if (!room || !adapter) return;
    try {
      await adapter.setControlMode(mode, deviceId);
      lastWriter = deviceId;
      room = {
        ...room,
        controlMode: mode,
        hostId: mode === CONTROL_MODES.HOST ? deviceId : room.hostId
      };
      emit();
    } catch (modeError) {
      setError(friendlyError(modeError));
    }
  }

  async function refreshSnapshot(code) {
    try {
      const fresh = await adapter.getSnapshot(code);
      const candidate = toRoom(fresh);
      if (
        candidate.sentAtGlobal != null &&
        (room?.sentAtGlobal == null || candidate.sentAtGlobal > room.sentAtGlobal)
      ) {
        lastWriter = candidate.hostId;
        pauseRef.current = now() + REMOTE_PAUSE_MS;
        room = candidate;
        emit();
      }
    } catch {
      // Sin snapshot fresco seguimos con el estado local.
    }
  }

  function startHostWatch() {
    if (hostWatch !== null) return;
    hostWatch = startInterval(() => {
      if (!room || room.controlMode !== CONTROL_MODES.HOST) {
        hostMissingSince = null;
        return;
      }
      // Presencia aún sin sincronizar: no se puede concluir que el host falte.
      if (devices.length === 0) return;
      if (devices.some((device) => device.deviceId === room.hostId)) {
        hostMissingSince = null;
        return;
      }
      if (hostMissingSince === null) {
        hostMissingSince = now();
        return;
      }
      if (now() - hostMissingSince < HOST_CLAIM_TIMEOUT_MS) return;

      const oldest = [...devices].sort(compareByJoinedAt)[0];
      if (oldest?.deviceId === deviceId) {
        hostMissingSince = null;
        claimHost();
      }
    }, HOST_WATCH_INTERVAL_MS);
  }

  async function startSession(row, existingAdapter) {
    adapter = existingAdapter ?? createAdapter();
    order.reset();
    lastWriter = row.host_id;
    room = toRoom(row);
    session = { code: row.code, deviceId };
    devices = [];
    hostMissingSince = null;
    emit();

    const presence = await adapter.joinRoom({
      code: row.code,
      deviceId,
      alias: getAlias() || 'Invitado',
      onControl: applyRemoteControl,
      onChat: (envelope) => {
        if (!order.register(envelope)) return;
        chatMessages = [
          ...chatMessages,
          {
            id: envelope.eventId,
            alias: envelope.alias || 'Invitado',
            text: String(envelope.text || '').slice(0, CHAT_MAX_LENGTH),
            at: now()
          }
        ].slice(-CHAT_HISTORY_LIMIT);
        emit();
      },
      onReaction: (envelope) => {
        if (!order.register(envelope)) return;
        addReaction({
          id: envelope.eventId || `reaction-${now()}`,
          emoji: envelope.emoji || '👏',
          alias: envelope.alias || 'Invitado',
          at: now()
        });
      },
      onPresence: (list) => {
        devices = list;
        emit();
      },
      onStatus: (nextStatus) => {
        status = nextStatus;
        emit();
        if (nextStatus === 'connected') refreshSnapshot(row.code);
      }
    });

    devices = presence;
    emit();
    startHostWatch();
  }

  async function createRoom(controlMode) {
    error = null;
    status = 'connecting';
    emit();

    const candidate = createAdapter();
    for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode();
      try {
        const row = await candidate.createRoom(code, deviceId, controlMode);
        await startSession(row, candidate);
        return code;
      } catch (createError) {
        if (String(createError?.message || '').includes('Código de sala ocupado')) continue;
        status = 'idle';
        setError(friendlyError(createError));
        return null;
      }
    }

    status = 'idle';
    setError('No se pudo generar un código libre. Inténtalo de nuevo.');
    return null;
  }

  async function joinRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    error = null;
    if (!isValidRoomCode(code)) {
      setError('El código tiene que ser de 6 caracteres válidos.');
      return null;
    }

    status = 'connecting';
    emit();

    const candidate = createAdapter();
    try {
      const row = await candidate.getSnapshot(code);
      await startSession(row, candidate);
      return code;
    } catch (joinError) {
      status = 'idle';
      setError(friendlyError(joinError));
      return null;
    }
  }

  async function leaveRoom() {
    if (saveTimer !== null) {
      clearTimer(saveTimer);
      saveTimer = null;
    }
    if (hostWatch !== null) {
      stopInterval(hostWatch);
      hostWatch = null;
    }
    reactionTimers.forEach((timer) => clearTimer(timer));
    reactionTimers.clear();

    const previous = adapter;
    adapter = null;
    try {
      await previous?.leaveRoom();
    } catch {
      // El canal puede estar ya cerrado.
    }

    order.reset();
    chatLimiter.reset();
    reactionLimiter.reset();
    room = null;
    session = null;
    devices = [];
    status = 'idle';
    error = null;
    chatMessages = [];
    reactions = [];
    lastWriter = '';
    hostMissingSince = null;
    lastControlAt = 0;
    emit();
  }

  function play(position) {
    return emitControl({ type: 'play', position, isPlaying: true });
  }

  function pause(position) {
    return emitControl({ type: 'pause', position, isPlaying: false });
  }

  function seek(position) {
    return emitControl({ type: 'seek', position, isPlaying: room?.isPlaying ?? false });
  }

  function selectMedia(media) {
    return emitControl({ type: 'media', media, position: 0, isPlaying: false });
  }

  return {
    createRoom,
    joinRoom,
    leaveRoom,
    destroy: leaveRoom,
    play,
    pause,
    seek,
    selectMedia,
    setControlMode,
    claimHost,
    sendReaction,
    sendChat,
    canControl,
    clearError,
    getState: state
  };
}
