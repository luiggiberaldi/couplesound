import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT_ACTIONS, decideDrift } from '../src/lib/drift.js';

const idle = { state: 'NEUTRAL', calmCycles: 0, supportsRate: true };

test('dentro de la banda fina mantiene velocidad 1', () => {
  const decision = decideDrift({ ...idle, drift: 0.01 });
  assert.equal(decision.state, 'NEUTRAL');
  assert.equal(decision.action, DRIFT_ACTIONS.RATE);
  assert.equal(decision.rate, 1);
});

test('atrasado acelera al 1.05', () => {
  const decision = decideDrift({ ...idle, drift: -0.1 });
  assert.equal(decision.state, 'CORRECTING');
  assert.equal(decision.rate, 1.05);
});

test('adelantado frena al 0.95', () => {
  const decision = decideDrift({ ...idle, drift: 0.1 });
  assert.equal(decision.state, 'CORRECTING');
  assert.equal(decision.rate, 0.95);
});

test('0.025 s ya entra en corrección (la banda fina es excluyente)', () => {
  const decision = decideDrift({ ...idle, drift: 0.025 });
  assert.equal(decision.state, 'CORRECTING');
  assert.equal(decision.rate, 0.95);
});

test('0.8 s exactos siguen siendo corrección elástica, no seek', () => {
  const decision = decideDrift({ ...idle, drift: 0.8 });
  assert.equal(decision.action, DRIFT_ACTIONS.RATE);
  assert.equal(decision.state, 'CORRECTING');
});

test('por encima de 0.8 s hace un único seek y vuelve a NEUTRAL', () => {
  const decision = decideDrift({ ...idle, drift: -1.2 });
  assert.equal(decision.action, DRIFT_ACTIONS.SEEK);
  assert.equal(decision.state, 'NEUTRAL');
  assert.equal(decision.rate, 1);
  assert.equal(decision.calmCycles, 0);
});

test('un solo ciclo por debajo de 0.015 s no saca de CORRECTING', () => {
  const decision = decideDrift({ state: 'CORRECTING', calmCycles: 0, supportsRate: true, drift: 0.01 });
  assert.equal(decision.state, 'CORRECTING');
  assert.equal(decision.action, DRIFT_ACTIONS.NONE);
  assert.equal(decision.calmCycles, 1);
});

test('dos ciclos consecutivos por debajo de 0.015 s devuelven a NEUTRAL con velocidad 1', () => {
  const decision = decideDrift({ state: 'CORRECTING', calmCycles: 1, supportsRate: true, drift: 0.012 });
  assert.equal(decision.state, 'NEUTRAL');
  assert.equal(decision.action, DRIFT_ACTIONS.RATE);
  assert.equal(decision.rate, 1);
  assert.equal(decision.calmCycles, 0);
});

test('si el drift vuelve a la banda elástica, el contador de calma se reinicia', () => {
  const decision = decideDrift({ state: 'CORRECTING', calmCycles: 1, supportsRate: true, drift: 0.03 });
  assert.equal(decision.state, 'CORRECTING');
  assert.equal(decision.calmCycles, 0);
  assert.equal(decision.rate, 0.95);
});

test('entre 0.015 y 0.025 en CORRECTING no toca la velocidad y reinicia la calma', () => {
  const decision = decideDrift({ state: 'CORRECTING', calmCycles: 1, supportsRate: true, drift: 0.02 });
  assert.equal(decision.action, DRIFT_ACTIONS.NONE);
  assert.equal(decision.calmCycles, 0);
  assert.equal(decision.state, 'CORRECTING');
});

test('un pico intermedio no completa la histéresis', () => {
  const first = decideDrift({ state: 'CORRECTING', calmCycles: 0, supportsRate: true, drift: 0.01 });
  const spike = decideDrift({
    state: first.state,
    calmCycles: first.calmCycles,
    supportsRate: true,
    drift: 0.03
  });
  const after = decideDrift({
    state: spike.state,
    calmCycles: spike.calmCycles,
    supportsRate: true,
    drift: 0.01
  });
  assert.equal(spike.calmCycles, 0);
  assert.equal(after.state, 'CORRECTING');
  assert.equal(after.calmCycles, 1);
});

test('sin supportsRate (YouTube) no toca la velocidad y solo busca por encima de 0.3 s', () => {
  const small = decideDrift({ ...idle, supportsRate: false, drift: 0.2 });
  assert.equal(small.action, DRIFT_ACTIONS.NONE);
  assert.equal(small.state, 'NEUTRAL');

  const large = decideDrift({ ...idle, supportsRate: false, drift: -0.4 });
  assert.equal(large.action, DRIFT_ACTIONS.SEEK);
  assert.equal(large.rate, null);
});

test('sin supportsRate, un drift enorme sigue usando seek', () => {
  const decision = decideDrift({ ...idle, supportsRate: false, drift: 5 });
  assert.equal(decision.action, DRIFT_ACTIONS.SEEK);
});
