import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMirror,
  formatBytes,
  formatClock,
  normalizeMediaName
} from '../src/lib/mediaMirror.js';

const fileMeta = { name: 'Peli.mp4', size: 1_000_000, duration: 600 };
const roomMedia = { kind: 'file', duration: 600, mirror: { name: 'peli.mp4', size: 1_000_000 } };

test('el mismo archivo coincide aunque cambie la extensión y las mayúsculas', () => {
  assert.equal(normalizeMediaName('PELI.MKV'), 'peli');
  const result = compareMirror({ ...fileMeta, name: 'PELI.mkv' }, roomMedia);
  assert.equal(result.matches, true);
  assert.deepEqual(result.issues, []);
});

test('un nombre distinto se reporta como discrepancia', () => {
  const result = compareMirror({ ...fileMeta, name: 'OtraPeli.mp4' }, roomMedia);
  assert.equal(result.matches, false);
  assert.equal(result.issues[0].code, 'name');
});

test('el tamaño admite un 2 % de margen y no más', () => {
  const exact = compareMirror({ ...fileMeta, size: 1_020_000 }, roomMedia);
  assert.equal(exact.matches, true);

  const outside = compareMirror({ ...fileMeta, size: 1_021_000 }, roomMedia);
  assert.equal(outside.matches, false);
  assert.equal(outside.issues[0].code, 'size');
});

test('la duración admite 1 s de margen y no más', () => {
  const exact = compareMirror({ ...fileMeta, duration: 601 }, roomMedia);
  assert.equal(exact.matches, true);

  const outside = compareMirror({ ...fileMeta, duration: 601.5 }, roomMedia);
  assert.equal(outside.matches, false);
  assert.equal(outside.issues[0].code, 'duration');
});

test('acumula todas las discrepancias, no solo la primera', () => {
  const result = compareMirror(
    { name: 'Otra.mp4', size: 2_000_000, duration: 300 },
    roomMedia
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['name', 'size', 'duration']
  );
});

test('sin archivo local o sin identidad de sala no hay coincidencia', () => {
  assert.equal(compareMirror(null, roomMedia).issues[0].code, 'incomplete');
  assert.equal(compareMirror(fileMeta, { kind: 'file' }).issues[0].code, 'incomplete');
});

test('no compara tamaño ni duración si la sala no los publicó', () => {
  const result = compareMirror(
    { name: 'peli.mp4', size: 5, duration: 1 },
    { kind: 'file', duration: 0, mirror: { name: 'peli.mp4', size: 0 } }
  );
  assert.equal(result.matches, true);
});

test('formatea bytes y tiempos para los mensajes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1_000_000), '976.6 KB');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65.4), '1:05');
});
