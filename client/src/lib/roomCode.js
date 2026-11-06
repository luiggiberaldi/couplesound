import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CODE_REGEX } from './constants.js';

/**
 * Código de 6 caracteres con alfabeto sin ambigüedad (sin O, 0, I, 1).
 * El generador de bytes es inyectable para poder probar el mapeo exacto.
 */
export function generateRoomCode(randomBytes) {
  const bytes = randomBytes
    ? randomBytes(ROOM_CODE_LENGTH)
    : crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));

  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[bytes[index] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(input) {
  return String(input ?? '')
    .trim()
    .toUpperCase();
}

export function isValidRoomCode(code) {
  return ROOM_CODE_REGEX.test(String(code ?? ''));
}

export function isRoomCodeAlphabetChar(char) {
  return ROOM_CODE_ALPHABET.includes(char);
}
