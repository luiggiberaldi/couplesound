import { supabase } from './supabase';
import { DEDUPE_LIMIT, EVENTS, STORAGE_SEQ } from './constants';

const CHANNEL_PREFIX = 'room:';

function nextSeq() {
  const stored = Number(localStorage.getItem(STORAGE_SEQ) || '0');
  const seq = Number.isFinite(stored) && stored > 0 ? stored + 1 : 1;
  localStorage.setItem(STORAGE_SEQ, String(seq));
  return seq;
}

function newEventId() {
  return crypto.randomUUID();
}

function toSessionList(state) {
  return Object.entries(state).flatMap(([key, metas]) =>
    metas.map((meta) => ({
      deviceId: meta.device_id || key,
      alias: meta.alias || 'Invitado',
      joinedAt: meta.joined_at || ''
    }))
  );
}

const noop = () => {};

/**
 * Interfaz de transporte de SyncWave (sección 6). Toda la conversación con
 * Supabase —Broadcast, Presence y RPC— pasa por aquí.
 */
export function createSyncAdapter() {
  let channel = null;
  let code = null;
  let deviceId = null;
  let alias = null;
  let status = 'idle';
  let presenceTracked = false;

  const handlers = {
    onControl: noop,
    onChat: noop,
    onReaction: noop,
    onPresence: noop,
    onStatus: noop
  };

  function setStatus(next) {
    if (status === next) return;
    status = next;
    handlers.onStatus(next);
  }

  function readPresence() {
    if (!channel) return [];
    return toSessionList(channel.presenceState());
  }

  async function joinRoom(options) {
    code = options.code;
    deviceId = options.deviceId;
    alias = options.alias || 'Invitado';
    handlers.onControl = options.onControl || noop;
    handlers.onChat = options.onChat || noop;
    handlers.onReaction = options.onReaction || noop;
    handlers.onPresence = options.onPresence || noop;
    handlers.onStatus = options.onStatus || noop;

    setStatus('connecting');

    channel = supabase.channel(`${CHANNEL_PREFIX}${code}`, {
      config: {
        broadcast: { self: false },
        presence: { key: deviceId }
      }
    });

    channel
      .on('broadcast', { event: EVENTS.CONTROL }, ({ payload }) => handlers.onControl(payload))
      .on('broadcast', { event: EVENTS.CHAT }, ({ payload }) => handlers.onChat(payload))
      .on('broadcast', { event: EVENTS.REACTION }, ({ payload }) => handlers.onReaction(payload))
      .on('presence', { event: 'sync' }, () => handlers.onPresence(readPresence()));

    await new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve();
      };

      // Sin este límite, un móvil sin red deja la UI en «Conectando…» para siempre.
      timeout = setTimeout(() => {
        setStatus('disconnected');
        finish();
      }, 8000);

      channel.subscribe(async (channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setStatus('connected');
          // track() una única vez por sesión: supabase-js reenvía la presencia al
          // re-unirse y el límite de Supabase son 5 llamadas cada 30 s.
          if (!presenceTracked) {
            presenceTracked = true;
            try {
              await channel.track({
                device_id: deviceId,
                alias,
                joined_at: new Date().toISOString()
              });
            } catch {
              handlers.onStatus('presence-error');
            }
          }
          finish();
        } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setStatus('disconnected');
          finish();
        } else if (channelStatus === 'CLOSED') {
          setStatus('closed');
          finish();
        }
      });
    });

    return readPresence();
  }

  async function leaveRoom() {
    if (channel) {
      try {
        await channel.untrack();
      } catch {
        // El canal puede estar ya cerrado: removeChannel limpia igualmente.
      }
      await supabase.removeChannel(channel);
    }
    channel = null;
    presenceTracked = false;
    status = 'idle';
  }

  function buildEnvelope(payload) {
    return {
      eventId: newEventId(),
      deviceId,
      seq: nextSeq(),
      ...payload
    };
  }

  async function send(event, payload) {
    if (!channel) throw new Error('El canal no está abierto');
    const envelope = buildEnvelope(payload);
    const result = await channel.send({ type: 'broadcast', event, payload: envelope });
    if (result !== 'ok') throw new Error(`Broadcast rechazado (${result})`);
    return envelope;
  }

  const sendControl = (payload) => send(EVENTS.CONTROL, payload);
  const sendReaction = (payload) => send(EVENTS.REACTION, payload);
  const sendChat = (payload) => send(EVENTS.CHAT, payload);

  async function createRoom(roomCode, creatorDeviceId, controlMode) {
    const { data, error } = await supabase.rpc('create_room', {
      p_code: roomCode,
      p_device_id: creatorDeviceId,
      p_control_mode: controlMode
    });
    if (error) throw error;
    return data;
  }

  async function getSnapshot(roomCode = code) {
    const { data, error } = await supabase.rpc('get_room', { p_code: roomCode });
    if (error) throw error;
    return data;
  }

  async function saveState({ position, isPlaying, sentAtGlobal, media }) {
    const { error } = await supabase.rpc('update_room', {
      p_code: code,
      p_device_id: deviceId,
      p_media: media ?? null,
      p_position: position,
      p_is_playing: isPlaying,
      p_sent_at_global: sentAtGlobal
    });
    if (error) throw error;
  }

  async function claimHost(targetCode = code, claimant = deviceId) {
    const { error } = await supabase.rpc('claim_host', {
      p_code: targetCode,
      p_device_id: claimant
    });
    if (error) throw error;
  }

  async function setControlMode(mode, actorDeviceId = deviceId) {
    const { error } = await supabase.rpc('set_control_mode', {
      p_code: code,
      p_device_id: actorDeviceId,
      p_mode: mode
    });
    if (error) throw error;
  }

  return {
    joinRoom,
    leaveRoom,
    sendControl,
    sendReaction,
    sendChat,
    createRoom,
    getSnapshot,
    saveState,
    claimHost,
    setControlMode,
    readPresence,
    isConnected: () => status === 'connected',
    dedupeLimit: DEDUPE_LIMIT
  };
}
