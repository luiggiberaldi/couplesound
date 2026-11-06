import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MANUAL_OFFSET_LIMIT_MS,
  STORAGE_ALIAS,
  STORAGE_DEVICE_ID,
  STORAGE_MANUAL_OFFSET
} from '../lib/constants';
import { createRoomSession } from '../lib/roomSession';
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

const EMPTY_STATE = {
  session: null,
  room: null,
  devices: [],
  status: 'idle',
  error: null,
  chatMessages: [],
  reactions: [],
  lastControlAt: 0
};

export function useSyncRoom() {
  const deviceIdRef = useRef(readDeviceId());
  const aliasRef = useRef(readAlias());
  const pausedUntilRef = useRef(0);

  const [alias, setAliasState] = useState(aliasRef.current);
  const [manualOffsetMs, setManualOffsetState] = useState(readManualOffset);
  const [snapshot, setSnapshot] = useState(EMPTY_STATE);

  const setAlias = useCallback((value) => {
    aliasRef.current = value;
    setAliasState(value);
    localStorage.setItem(STORAGE_ALIAS, value);
  }, []);

  const setManualOffsetMs = useCallback((value) => {
    const clamped = Math.min(MANUAL_OFFSET_LIMIT_MS, Math.max(-MANUAL_OFFSET_LIMIT_MS, value));
    setManualOffsetState(clamped);
    localStorage.setItem(STORAGE_MANUAL_OFFSET, String(clamped));
  }, []);

  const controller = useMemo(
    () =>
      createRoomSession({
        createAdapter: createSyncAdapter,
        deviceId: deviceIdRef.current,
        getAlias: () => aliasRef.current,
        getGlobalNow,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (handle) => clearTimeout(handle),
        startInterval: (fn, ms) => setInterval(fn, ms),
        stopInterval: (handle) => clearInterval(handle),
        pauseRef: pausedUntilRef,
        onChange: setSnapshot
      }),
    []
  );

  useEffect(
    () => () => {
      controller.destroy();
    },
    [controller]
  );

  return {
    deviceId: deviceIdRef.current,
    alias,
    setAlias,
    session: snapshot.session,
    room: snapshot.room,
    devices: snapshot.devices,
    status: snapshot.status,
    error: snapshot.error,
    clearError: controller.clearError,
    createRoom: controller.createRoom,
    joinRoom: controller.joinRoom,
    leaveRoom: controller.leaveRoom,
    play: controller.play,
    pause: controller.pause,
    seek: controller.seek,
    selectMedia: controller.selectMedia,
    setControlMode: controller.setControlMode,
    claimHost: controller.claimHost,
    sendReaction: controller.sendReaction,
    sendChat: controller.sendChat,
    chatMessages: snapshot.chatMessages,
    reactions: snapshot.reactions,
    canControl: controller.canControl,
    manualOffsetMs,
    setManualOffsetMs,
    pausedUntilRef,
    lastControlAt: snapshot.lastControlAt
  };
}
