import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventOrder } from '../src/lib/order.js';

const event = (deviceId, seq, eventId, sentAtGlobal = 1000) => ({
  deviceId,
  seq,
  eventId,
  sentAtGlobal
});

test('rechaza duplicados por eventId', () => {
  const order = createEventOrder();
  assert.equal(order.register(event('A', 1, 'e1')), true);
  assert.equal(order.register(event('A', 1, 'e1')), false);
});

test('rechaza eventos reordenados de un mismo emisor', () => {
  const order = createEventOrder();
  assert.equal(order.register(event('A', 5, 'e5')), true);
  assert.equal(order.register(event('A', 4, 'e4')), false);
  assert.equal(order.register(event('A', 5, 'e5bis')), false);
  assert.equal(order.register(event('A', 6, 'e6')), true);
});

test('lleva la secuencia por separado para cada dispositivo', () => {
  const order = createEventOrder();
  assert.equal(order.register(event('A', 10, 'a10')), true);
  assert.equal(order.register(event('B', 1, 'b1')), true);
  assert.equal(order.lastSeqFor('A'), 10);
  assert.equal(order.lastSeqFor('B'), 1);
});

test('el dedupe está acotado y deja de recordar los ids más antiguos', () => {
  const order = createEventOrder({ dedupeLimit: 2 });
  assert.equal(order.register(event('A', 1, 'e1')), true);
  assert.equal(order.register(event('A', 2, 'e2')), true);
  assert.equal(order.register(event('A', 3, 'e3')), true);
  assert.equal(order.size(), 2);
  // e1 ya no está en memoria, pero su seq sigue descartándolo.
  assert.equal(order.register(event('A', 4, 'e1')), true);
});

test('gana el sentAtGlobal mayor', () => {
  const order = createEventOrder();
  const current = { sentAtGlobal: 1000 };
  assert.equal(order.isNewer(event('B', 1, 'x', 1001), current, 'A'), true);
  assert.equal(order.isNewer(event('B', 1, 'x', 999), current, 'A'), false);
});

test('en empate gana el deviceId lexicográficamente menor', () => {
  const order = createEventOrder();
  const current = { sentAtGlobal: 1000 };
  assert.equal(order.isNewer(event('A', 1, 'x', 1000), current, 'B'), true);
  assert.equal(order.isNewer(event('B', 1, 'x', 1000), current, 'A'), false);
  assert.equal(order.isNewer(event('B', 1, 'x', 1000), current, 'B'), false);
});

test('sin estado previo o sin ancla temporal cualquier evento es más nuevo', () => {
  const order = createEventOrder();
  assert.equal(order.isNewer(event('A', 1, 'x', 10), null, 'A'), true);
  assert.equal(order.isNewer(event('A', 1, 'x', 10), { sentAtGlobal: null }, 'A'), true);
});

test('reset olvida secuencias, ids y escritor', () => {
  const order = createEventOrder();
  order.register(event('A', 7, 'e7'));
  order.noteWriter('A');
  order.reset();
  assert.equal(order.lastSeqFor('A'), undefined);
  assert.equal(order.size(), 0);
  assert.equal(order.register(event('A', 1, 'e7')), true);
});
