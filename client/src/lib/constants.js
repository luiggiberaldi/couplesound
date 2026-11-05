// Umbrales y nombres compartidos. Un solo sitio para cambiarlos.

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;
export const ROOM_CODE_LENGTH = 6;
export const MAX_ROOM_CREATE_ATTEMPTS = 5;

// Reloj (3.A)
export const CLOCK_SAMPLES = 5;
export const CLOCK_RTT_FILTER_MS = 800;
export const CLOCK_RECALIBRATE_MS = 30000;
export const CLOCK_SAMPLE_GAP_MS = 120;
export const MIN_ACCURACY_SAMPLES = 3;

// Deriva (3.C)
export const DRIFT_INTERVAL_MS = 500;
export const DRIFT_SOFT_SECONDS = 0.025;
export const DRIFT_HYSTERESIS_SECONDS = 0.015;
export const DRIFT_HARD_SECONDS = 0.8;
export const DRIFT_CALM_CYCLES = 2;
export const YOUTUBE_SEEK_SECONDS = 0.3;
export const RATE_FAST = 1.05;
export const RATE_SLOW = 0.95;

// Ecos (3.E)
export const NATIVE_EVENT_SUPPRESS_MS = 150;
export const REMOTE_PAUSE_MS = 300;
export const DEDUPE_LIMIT = 200;

// Anfitrión (3.B.3)
export const HOST_CLAIM_TIMEOUT_MS = 10000;
export const HOST_WATCH_INTERVAL_MS = 2000;

// Chat y reacciones (3.G)
export const CHAT_MIN_INTERVAL_MS = 2000;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY_LIMIT = 60;
export const REACTION_MIN_INTERVAL_MS = 150;
export const REACTION_TTL_MS = 4000;

// Interfaz (5)
export const MANUAL_OFFSET_LIMIT_MS = 200;
export const SAVE_DEBOUNCE_MS = 250;

// Almacenamiento local
export const STORAGE_DEVICE_ID = 'sw_device_id';
export const STORAGE_ALIAS = 'sw_alias';
export const STORAGE_SEQ = 'sw_seq';
export const STORAGE_MANUAL_OFFSET = 'sw_manual_offset_ms';

export const EVENTS = {
  CONTROL: 'control',
  CHAT: 'chat',
  REACTION: 'reaction'
};

export const CONTROL_MODES = {
  FREE: 'free',
  HOST: 'host'
};

export const MEDIA_KINDS = {
  URL: 'url',
  YOUTUBE: 'youtube',
  FILE: 'file'
};
