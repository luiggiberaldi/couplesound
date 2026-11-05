import { useCallback, useEffect, useRef, useState } from 'react';
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
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_REGEX,
  SAVE_DEBOUNCE_MS,
  STORAGE_ALIAS,
  STORAGE_DEVICE_ID,
  STORAGE_MANUAL_OFFSET,
  MANUAL_OFFSET_LIMIT_MS
} from '../lib/constants';
import { createSyncAdapter } from '../lib/syncAdapter';
import { getGlobalNow } from './useClockSync';

function readDeviceId() {
  const existing = sessionStorage.getItem(STORAGE_DEVICE_ID);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(STORAGE_DEVICE_ID, created);
  return created;
}

function readAlias() {
  return localStorage.getItem(STORAGE_ALIAS) || '';
}

function readManualOffset() {
  const stored = Number(localStorage.getItem(STORAGE_MANUAL_OFFSET) || '0');
  if (!Number.isFinite(stored)) return 0;
  return Math.min(MANUAL_OFFSET_LIMIT_MS, Math.max(-MANUAL_OFFSET_LIMIT_MS, stored));
}

function randomRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[bytes[index] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function toRoom(row) {
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

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (message.includes('Código de sala ocupado')) return 'Ese código ya está en uso, prueba otra vez.';
  if (message.includes('no existe o ya se cerró')) return 'Esa sala no existe o ya se cerró.';
  if (message.includes('Código de sala inválido')) return 'El código tiene que ser de 6 caracteres válidos.';
  if (message.includes('Solo el anfitrión')) return 'Solo el anfitrión controla esta sala.';
  if (message.includes('La sala no está en modo anfitrión')) return 'La sala no está en modo anfitrión.';
  if (message.toLowerCase().includes('failed to fetch')) return 'Sin conexión con Supabase.';
  return message || 'Algo ha ido mal.';
}

export function useSyncRoom() {
  const deviceIdRef = useRef(readDeviceId());
  const adapterRef = useRef(null);
  const roomRef = useRef(null);
  const lastWriterRef = useRef('');
  const lastSeqRef = useRef(new Map());
  const seenRef = useRef(new Set());
  const seenOrderRef = useRef([]);
  const pausedUntilRef = useRef(0);
  const saveTimerRef = useRef(null);
  const reactionTimersRef = useRef(new Set());
  const lastChatAtRef = useRef(0);
  const lastReactionAtRef = useRef(0);
  const hostMissingSinceRef = useRef(null);
  const devicesRef = useRef([]);
  const sessionRef = useRef(null);

  const [session, setSession] = useState(null);
  const [room, setRoom] = useState(null);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [alias, setAliasState] = useState(readAlias);
  const [manualOffsetMs, setManualOffsetState] = useState(readManualOffset);
  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [lastControlAt, setLastControlAt] = useState(0);

  const commitRoom = useCallback((next) => {
    roomRef.current = next;
    setRoom(next);
  }, []);

  const setAlias = useCallback((value) => {
    setAliasState(value);
    localStorage.setItem(STORAGE_ALIAS, value);
  }, []);

  const setManualOffsetMs = useCallback((value) => {
    const clamped = Math.min(MANUAL_OFFSET_LIMIT_MS, Math.max(-MANUAL_OFFSET_LIMIT_MS, value));
    setManualOffsetState(clamped);
    localStorage.setItem(STORAGE_MANUAL_OFFSET, String(clamped));
  }, []);

  const registerEvent = useCallback((envelope) => {
    if (!envelope?.eventId) return false;
    if (seenRef.current.has(envelope.eventId)) return false;

    const previousSeq = lastSeqRef.current.get(envelope.deviceId) ?? -1;
    if (Number(envelope.seq) <= previousSeq) return false;

    lastSeqRef.current.set(envelope.deviceId, Number(envelope.seq));
    seenRef.current.add(envelope.eventId);
    seenOrderRef.current.push(envelope.eventId);

    while (seenOrderRef.current.length > DEDUPE_LIMIT) {
      const oldest = seenOrderRef.current.shift();
      seenRef.current.delete(oldest);
    }
    return true;
  }, []);

  const isNewerThanRoom = useCallback((envelope) => {
    const current = roomRef.current;
    if (!current) return true;
    if (current.sentAtGlobal == null) return true;
    if (envelope.sentAtGlobal > current.sentAtGlobal) return true;
    if (envelope.sentAtGlobal < current.sentAtGlobal) return false;
    // Empate al milisegundo: gana el deviceId lexicográficamente menor.
    if (envelope.deviceId === lastWriterRef.current) return false;
    return envelope.deviceId < lastWriterRef.current;
  }, []);

  const scheduleSave = useCallback((next) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      try {
        await adapterRef.current?.saveState({
          media: next.media,
          position: next.position,
          isPlaying: next.isPlaying,
          sentAtGlobal: next.sentAtGlobal
        });
      } catch (saveError) {
        // En modo host, un dispositivo sin permiso no debe romper la UI: el
        // evento ya salió y el snapshot lo escribe el anfitrión.
        console.warn('No se pudo guardar el snapshot:', friendlyError(saveError));
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const canControl = useCallback(() => {
    const current = roomRef.current;
    if (!current) return false;
    if (current.controlMode !== CONTROL_MODES.HOST) return true;
    return current.hostId === deviceIdRef.current;
  }, []);

  const emitControl = useCallback(
    async ({ type, media = null, position, isPlaying }) => {
      const current = roomRef.current;
      if (!current) return;
      if (!canControl()) {
        setError('Solo el anfitrión controla esta sala.');
        return;
      }

      const sentAtGlobal = getGlobalNow();
      const next = {
        ...current,
        media: media ?? current.media,
        position,
        isPlaying,
        sentAtGlobal
      };

      lastWriterRef.current = deviceIdRef.current;
      pausedUntilRef.current = Date.now() + REMOTE_PAUSE_MS;
      commitRoom(next);
      setLastControlAt(Date.now());
      scheduleSave(next);

      try {
        await adapterRef.current?.sendControl({
          type,
          media: media ?? current.media,
          position,
          isPlaying,
          sentAtGlobal
        });
      } catch (sendError) {
        setError(friendlyError(sendError));
      }
    },
    [canControl, commitRoom, scheduleSave]
  );

  const play = useCallback(
    (position) => emitControl({ type: 'play', position, isPlaying: true }),
    [emitControl]
  );
  const pause = useCallback(
    (position) => emitControl({ type: 'pause', position, isPlaying: false }),
    [emitControl]
  );
  const seek = useCallback(
    (position) => {
      const current = roomRef.current;
      return emitControl({ type: 'seek', position, isPlaying: current?.isPlaying ?? false });
    },
    [emitControl]
  );

  const selectMedia = useCallback(
    (media) => emitControl({ type: 'media', media, position: 0, isPlaying: false }),
    [emitControl]
  );

  const applyRemoteControl = useCallback(
    (envelope) => {
      if (!envelope || envelope.deviceId === deviceIdRef.current) return;
      if (!registerEvent(envelope)) return;
      if (!isNewerThanRoom(envelope)) return;

      const previous = roomRef.current;
      const next = {
        ...previous,
        media: envelope.media ?? previous.media,
        position: Number(envelope.position) || 0,
        isPlaying: Boolean(envelope.isPlaying),
        sentAtGlobal: Number(envelope.sentAtGlobal)
      };

      lastWriterRef.current = envelope.deviceId;
      pausedUntilRef.current = Date.now() + REMOTE_PAUSE_MS;
      commitRoom(next);
      setLastControlAt(Date.now());
    },
    [commitRoom, isNewerThanRoom, registerEvent]
  );

  const addReaction = useCallback((reaction) => {
    setReactions((previous) => [...previous, reaction]);
    const timer = setTimeout(() => {
      setReactions((previous) => previous.filter((item) => item.id !== reaction.id));
      reactionTimersRef.current.delete(timer);
    }, REACTION_TTL_MS);
    reactionTimersRef.current.add(timer);
  }, []);

  const sendReaction = useCallback(
    async (emoji) => {
      const now = Date.now();
      // Ráfaga agrupada: como máximo un evento cada 150 ms por dispositivo.
      if (now - lastReactionAtRef.current < REACTION_MIN_INTERVAL_MS) return false;
      lastReactionAtRef.current = now;
      const reaction = {
        id: crypto.randomUUID(),
        emoji,
        alias: alias || 'Invitado',
        at: now
      };
      addReaction(reaction);
      try {
        await adapterRef.current?.sendReaction({
          emoji,
          alias: reaction.alias,
          sentAtGlobal: getGlobalNow()
        });
      } catch (sendError) {
        setError(friendlyError(sendError));
      }
      return true;
    },
    [addReaction, alias]
  );

  const sendChat = useCallback(
    async (text) => {
      const clean = String(text || '').trim().slice(0, CHAT_MAX_LENGTH);
      if (!clean) return { ok: false, reason: 'vacío' };
      const now = Date.now();
      if (now - lastChatAtRef.current < CHAT_MIN_INTERVAL_MS) {
        return { ok: false, reason: 'espera' };
      }
      lastChatAtRef.current = now;
      const message = {
        id: crypto.randomUUID(),
        alias: alias || 'Invitado',
        text: clean,
        at: now
      };
      setChatMessages((previous) => [...previous, message].slice(-CHAT_HISTORY_LIMIT));
      try {
        await adapterRef.current?.sendChat({ text: clean, alias: message.alias });
      } catch (sendError) {
        setError(friendlyError(sendError));
      }
      return { ok: true };
    },
    [alias]
  );

  const claimHost = useCallback(async () => {
    if (!roomRef.current) return;
    try {
      await adapterRef.current?.claimHost(roomRef.current.code, deviceIdRef.current);
      const next = {
        ...roomRef.current,
        hostId: deviceIdRef.current,
        controlMode: CONTROL_MODES.HOST
      };
      lastWriterRef.current = deviceIdRef.current;
      commitRoom(next);
    } catch (claimError) {
      setError(friendlyError(claimError));
    }
  }, [commitRoom]);

  const setControlMode = useCallback(
    async (mode) => {
      if (!roomRef.current) return;
      try {
        await adapterRef.current?.setControlMode(mode, deviceIdRef.current);
        const next = {
          ...roomRef.current,
          controlMode: mode,
          hostId: mode === CONTROL_MODES.HOST ? deviceIdRef.current : roomRef.current.hostId
        };
        lastWriterRef.current = deviceIdRef.current;
        commitRoom(next);
      } catch (modeError) {
        setError(friendlyError(modeError));
      }
    },
    [commitRoom]
  );

  const startSession = useCallback(
    async (row) => {
      const adapter = createSyncAdapter();
      adapterRef.current = adapter;

      lastSeqRef.current = new Map();
      seenRef.current = new Set();
      seenOrderRef.current = [];
      lastWriterRef.current = row.host_id;

      const nextRoom = toRoom(row);
      commitRoom(nextRoom);
      setSession({ code: row.code, deviceId: deviceIdRef.current });
      sessionRef.current = { code: row.code, deviceId: deviceIdRef.current };

      const presence = await adapter.joinRoom({
        code: row.code,
        deviceId: deviceIdRef.current,
        alias: alias || 'Invitado',
        onControl: applyRemoteControl,
        onChat: (envelope) => {
          if (!registerEvent(envelope)) return;
          setChatMessages((previous) =>
            [
              ...previous,
              {
                id: envelope.eventId,
                alias: envelope.alias || 'Invitado',
                text: String(envelope.text || '').slice(0, CHAT_MAX_LENGTH),
                at: Date.now()
              }
            ].slice(-CHAT_HISTORY_LIMIT)
          );
        },
        onReaction: (envelope) => {
          if (!registerEvent(envelope)) return;
          addReaction({
            id: envelope.eventId || crypto.randomUUID(),
            emoji: envelope.emoji || '👏',
            alias: envelope.alias || 'Invitado',
            at: Date.now()
          });
        },
        onPresence: (list) => {
          devicesRef.current = list;
          setDevices(list);
        },
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus === 'connected' && roomRef.current) {
            // Al reconectar: releer el snapshot y aplicarlo si es más nuevo.
            adapter
              .getSnapshot(row.code)
              .then((fresh) => {
                const candidate = toRoom(fresh);
                if (
                  candidate.sentAtGlobal != null &&
                  (nextRoom.sentAtGlobal == null ||
                    candidate.sentAtGlobal > (roomRef.current?.sentAtGlobal ?? -1))
                ) {
                  lastWriterRef.current = candidate.hostId;
                  pausedUntilRef.current = Date.now() + REMOTE_PAUSE_MS;
                  commitRoom(candidate);
                }
              })
              .catch(() => {
                // Sin snapshot fresco seguimos con el estado local.
              });
          }
        }
      });

      devicesRef.current = presence;
      setDevices(presence);
    },
    [addReaction, alias, applyRemoteControl, commitRoom, registerEvent]
  );

  const createRoom = useCallback(
    async (controlMode) => {
      setError(null);
      setStatus('connecting');
      const adapter = createSyncAdapter();
      adapterRef.current = adapter;

      for (let attempt = 0; attempt < MAX_ROOM_CREATE_ATTEMPTS; attempt += 1) {
        const code = randomRoomCode();
        try {
          const row = await adapter.createRoom(code, deviceIdRef.current, controlMode);
          await startSession(row);
          return code;
        } catch (createError) {
          const message = String(createError?.message || '');
          if (message.includes('Código de sala ocupado')) continue;
          setStatus('idle');
          setError(friendlyError(createError));
          return null;
        }
      }

      setStatus('idle');
      setError('No se pudo generar un código libre. Inténtalo de nuevo.');
      return null;
    },
    [startSession]
  );

  const joinRoom = useCallback(
    async (rawCode) => {
      const code = String(rawCode || '').trim().toUpperCase();
      setError(null);
      if (!ROOM_CODE_REGEX.test(code)) {
        setError('El código tiene que ser de 6 caracteres válidos.');
        return null;
      }
      setStatus('connecting');
      const adapter = createSyncAdapter();
      adapterRef.current = adapter;
      try {
        const row = await adapter.getSnapshot(code);
        await startSession(row);
        return code;
      } catch (joinError) {
        setStatus('idle');
        setError(friendlyError(joinError));
        return null;
      }
    },
    [startSession]
  );

  const leaveRoom = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await adapterRef.current?.leaveRoom();
    adapterRef.current = null;
    sessionRef.current = null;
    roomRef.current = null;
    lastWriterRef.current = '';
    hostMissingSinceRef.current = null;
    devicesRef.current = [];
    setSession(null);
    setRoom(null);
    setDevices([]);
    setStatus('idle');
    setChatMessages([]);
    setReactions([]);
  }, []);

  // Traspaso de anfitrión: si el host_id no aparece en presencia 10 s, el
  // dispositivo conectado más antiguo reclama el control (3.B.3).
  useEffect(() => {
    if (!session) return undefined;
    const interval = setInterval(() => {
      const current = roomRef.current;
      if (!current || current.controlMode !== CONTROL_MODES.HOST) {
        hostMissingSinceRef.current = null;
        return;
      }
      const present = devicesRef.current;
      if (present.length === 0) return; // presencia aún sin sincronizar
      const hostPresent = present.some((device) => device.deviceId === current.hostId);
      if (hostPresent) {
        hostMissingSinceRef.current = null;
        return;
      }
      if (!hostMissingSinceRef.current) {
        hostMissingSinceRef.current = Date.now();
        return;
      }
      if (Date.now() - hostMissingSinceRef.current < HOST_CLAIM_TIMEOUT_MS) return;

      const oldest = [...present].sort((a, b) => {
        if (a.joinedAt === b.joinedAt) return a.deviceId < b.deviceId ? -1 : 1;
        return a.joinedAt < b.joinedAt ? -1 : 1;
      })[0];

      if (oldest?.deviceId === deviceIdRef.current) {
        hostMissingSinceRef.current = null;
        claimHost();
      }
    }, HOST_WATCH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [claimHost, session]);

  useEffect(
    () => () => {
      reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
      reactionTimersRef.current.clear();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  return {
    deviceId: deviceIdRef.current,
    alias,
    setAlias,
    session,
    room,
    devices,
    status,
    error,
    clearError: () => setError(null),
    createRoom,
    joinRoom,
    leaveRoom,
    play,
    pause,
    seek,
    selectMedia,
    setControlMode,
    claimHost,
    sendReaction,
    sendChat,
    chatMessages,
    reactions,
    canControl,
    manualOffsetMs,
    setManualOffsetMs,
    pausedUntilRef,
    lastControlAt
  };
}
