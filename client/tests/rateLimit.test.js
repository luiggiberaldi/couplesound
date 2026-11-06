import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, normalizeChatText } from '../src/lib/rateLimit.js';

function withClock() {
  let current = 0;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    }
  };
}

test('la primera llamada siempre pasa y la segunda inmediata no', () => {
  const clock = withClock();
  const limiter = createRateLimiter({ minIntervalMs: 2000, now: clock.now });
  assert.equal(limiter.consume(), true);
  assert.equal(limiter.consume(), false);
});

test('vuelve a pasar justo al cumplir el intervalo', () => {
  const clock = withClock();
  const limiter = createRateLimiter({ minIntervalMs: 2000, now: clock.now });
  limiter.consume();
  clock.advance(1999);
  assert.equal(limiter.canProceed(), false);
  clock.advance(1);
  assert.equal(limiter.consume(), true);
});

test('un intento rechazado no reinicia la espera', () => {
  const clock = withClock();
  const limiter = createRateLimiter({ minIntervalMs: 150, now: clock.now });
  limiter.consume();
  clock.advance(100);
  assert.equal(limiter.consume(), false);
  clock.advance(50);
  assert.equal(limiter.consume(), true);
});

test('reset permite enviar de inmediato', () => {
  const clock = withClock();
  const limiter = createRateLimiter({ minIntervalMs: 2000, now: clock.now });
  limiter.consume();
  assert.equal(limiter.consume(), false);
  limiter.reset();
  assert.equal(limiter.consume(), true);
});

test('expone el último envío aceptado', () => {
  const clock = withClock();
  const limiter = createRateLimiter({ minIntervalMs: 100, now: clock.now });
  assert.equal(limiter.lastRunAt(), null);
  clock.advance(500);
  limiter.consume();
  assert.equal(limiter.lastRunAt(), 500);
});

test('el chat recorta a 200 caracteres y descarta espacios', () => {
  assert.equal(normalizeChatText('  hola  '), 'hola');
  assert.equal(normalizeChatText('   '), '');
  assert.equal(normalizeChatText(null), '');
  assert.equal(normalizeChatText('a'.repeat(250)).length, 200);
  assert.equal(normalizeChatText('b'.repeat(250), 40).length, 40);
});
