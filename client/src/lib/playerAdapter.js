// Contrato único de reproductor (3.C.1). El bucle de deriva no sabe si enfrente
// hay un <video>, un <audio> o el iframe de YouTube.

export const PLAYER_CONTRACT = [
  'getPosition',
  'getDuration',
  'seekTo',
  'setRate',
  'play',
  'pause',
  'setVolume',
  'supportsRate'
];

function safeDuration(media) {
  return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
}

export function createNativePlayer(media) {
  // preservesPitch mantiene el tono al cambiar playbackRate. Se fija explícitamente
  // porque no todos los navegadores resuelven igual el valor por defecto.
  const setPitchPreservation = () => {
    if ('preservesPitch' in media) media.preservesPitch = true;
    if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = true;
    if ('mozPreservesPitch' in media) media.mozPreservesPitch = true;
  };

  setPitchPreservation();

  return {
    kind: 'native',
    supportsRate: true,
    getPosition: () => (Number.isFinite(media.currentTime) ? media.currentTime : 0),
    getDuration: () => safeDuration(media),
    seekTo: (seconds) => {
      const duration = safeDuration(media);
      const target = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
      try {
        media.currentTime = target;
      } catch {
        // El navegador aún no tiene metadatos: el siguiente ciclo reintenta.
      }
    },
    setRate: (rate) => {
      setPitchPreservation();
      media.playbackRate = rate;
    },
    play: () => media.play(),
    pause: () => media.pause(),
    setVolume: (volume) => {
      media.volume = Math.min(1, Math.max(0, volume));
    }
  };
}

export function createYouTubePlayer(player) {
  return {
    kind: 'youtube',
    supportsRate: false,
    getPosition: () => (typeof player.getCurrentTime === 'function' ? player.getCurrentTime() || 0 : 0),
    getDuration: () => (typeof player.getDuration === 'function' ? player.getDuration() || 0 : 0),
    seekTo: (seconds) => {
      try {
        player.seekTo(Math.max(0, seconds), true);
      } catch {
        // El player todavía no está listo: el bucle volverá a intentarlo.
      }
    },
    setRate: () => {
      // La IFrame API no permite cambiar la velocidad: supportsRate = false.
    },
    play: async () => {
      player.playVideo();
    },
    pause: () => {
      player.pauseVideo();
    },
    setVolume: (volume) => {
      if (typeof player.setVolume === 'function') player.setVolume(Math.round(volume * 100));
    }
  };
}

export function extractYouTubeId(input) {
  const value = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isAudioSource(media) {
  if (!media) return false;
  if (media.kind === 'file') return String(media.mirror?.type || '').startsWith('audio/');
  const src = String(media.src || '');
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(src);
}
