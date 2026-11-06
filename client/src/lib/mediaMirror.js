// Identidad del archivo local espejo (5.3): nombre normalizado, tamaño ±2 % y
// duración ±1 s. Sin DOM ni estado, para poder probarlo.

export const MIRROR_SIZE_TOLERANCE = 0.02;
export const MIRROR_DURATION_TOLERANCE_SECONDS = 1;

export function normalizeMediaName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .trim();
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

/**
 * Compara el archivo local con la identidad publicada en la sala.
 * Devuelve { matches, issues[] } con un código por discrepancia.
 */
export function compareMirror(fileMeta, roomMedia) {
  if (!fileMeta || !roomMedia?.mirror) {
    return {
      matches: false,
      issues: [
        { code: 'incomplete', message: 'Falta tu archivo o la identidad del archivo de la sala.' }
      ]
    };
  }

  const issues = [];
  const localName = normalizeMediaName(fileMeta.name);
  const roomName = normalizeMediaName(roomMedia.mirror.name);

  if (localName !== roomName) {
    issues.push({
      code: 'name',
      message: `Nombre distinto: “${localName}” frente a “${roomName}”.`,
      actual: localName,
      expected: roomName
    });
  }

  const roomSize = Number(roomMedia.mirror.size) || 0;
  if (roomSize > 0) {
    const deviation = Math.abs(fileMeta.size - roomSize) / roomSize;
    if (deviation > MIRROR_SIZE_TOLERANCE) {
      issues.push({
        code: 'size',
        message: `Tamaño distinto: ${formatBytes(fileMeta.size)} frente a ${formatBytes(roomSize)}.`,
        actual: fileMeta.size,
        expected: roomSize
      });
    }
  }

  const roomDuration = Number(roomMedia.duration) || 0;
  if (roomDuration > 0) {
    const localDuration = Number(fileMeta.duration) || 0;
    if (Math.abs(localDuration - roomDuration) > MIRROR_DURATION_TOLERANCE_SECONDS) {
      issues.push({
        code: 'duration',
        message: `Duración distinta: ${formatClock(localDuration)} frente a ${formatClock(roomDuration)}.`,
        actual: localDuration,
        expected: roomDuration
      });
    }
  }

  return { matches: issues.length === 0, issues };
}
