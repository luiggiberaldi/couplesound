import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomCode,
  isRoomCodeAlphabetChar,
  isValidRoomCode,
  normalizeRoomCode
} from '../src/lib/roomCode.js';

const bytesOf = (...values) => () => new Uint8Array(values);

test('genera 6 caracteres del alfabeto sin ambigüedad', () => {
  const code = generateRoomCode();
  assert.equal(code.length, 6);
  assert.equal(isValidRoomCode(code), true);
  for (const char of code) {
    assert.equal(isRoomCodeAlphabetChar(char), true, `carácter inesperado: ${char}`);
    assert.equal(['O', '0', 'I', '1'].includes(char), false, `carácter ambiguo: ${char}`);
  }
});

test('nunca genera caracteres ambiguos en muchas tiradas', () => {
  for (let round = 0; round < 200; round += 1) {
    const code = generateRoomCode();
    assert.equal(isValidRoomCode(code), true);
    assert.equal(/[O0I1]/.test(code), false, `código con ambiguo: ${code}`);
  }
});

test('el mapeo de bytes es determinista', () => {
  assert.equal(generateRoomCode(bytesOf(0, 1, 2, 3, 4, 5)), 'ABCDEF');
  // 255 % 32 = 31 -> último carácter del alfabeto.
  assert.equal(generateRoomCode(bytesOf(255, 255, 255, 255, 255, 255)), '999999');
});

test('normaliza mayúsculas y espacios sobrantes', () => {
  assert.equal(normalizeRoomCode('  abc234 '), 'ABC234');
  assert.equal(normalizeRoomCode(null), '');
});

test('rechaza códigos con longitud o caracteres incorrectos', () => {
  assert.equal(isValidRoomCode('ABC23'), false);
  assert.equal(isValidRoomCode('ABC2345'), false);
  assert.equal(isValidRoomCode('abc234'), false);
  assert.equal(isValidRoomCode('AB0234'), false);
  assert.equal(isValidRoomCode('ABI234'), false);
  assert.equal(isValidRoomCode(''), false);
  assert.equal(isValidRoomCode('ABC234'), true);
});
