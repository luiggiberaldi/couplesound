import test from 'node:test';
import assert from 'node:assert/strict';
import { computeClock, quantile, selectSamples } from '../src/lib/clockMath.js';

const sample = (rtt, offset) => ({ rtt, offset });

test('sin muestras no hay offset ni precisión', () => {
  const result = computeClock({ samples: [] });
  assert.equal(result.offset, 0);
  assert.equal(result.accuracy, null);
  assert.equal(result.degraded, true);
  assert.equal(result.minRtt, null);
});

test('con una o dos muestras se marca degradado y no se inventa precisión', () => {
  for (const count of [1, 2]) {
    const samples = Array.from({ length: count }, (_, index) => sample(40 + index, 10 + index));
    const result = computeClock({ samples });
    assert.equal(result.degraded, true);
    assert.equal(result.accuracy, null);
    assert.equal(result.samplesUsed, count);
  }
});

test('la mediana ignora el atípico y la precisión respeta el suelo minRtt/2', () => {
  const result = computeClock({
    samples: [sample(40, 10), sample(50, 11), sample(60, 12), sample(70, 13), sample(80, 14)]
  });
  assert.equal(result.offset, 12);
  assert.equal(result.degraded, false);
  // IQR/2 = 1 ms, pero la asimetría de red impone minRtt/2 = 20 ms.
  assert.equal(result.accuracy, 20);
});

test('descarta muestras por encima de 800 ms de RTT', () => {
  const result = computeClock({
    samples: [sample(40, 10), sample(45, 11), sample(50, 12), sample(900, 9000)]
  });
  assert.equal(result.samplesUsed, 3);
  assert.equal(result.offset, 11);
  assert.equal(result.degraded, false);
});

test('descarta muestras con más del doble del mejor RTT', () => {
  const result = computeClock({
    samples: [sample(40, 10), sample(45, 11), sample(50, 12), sample(200, 5000)]
  });
  assert.equal(result.samplesUsed, 3);
  assert.equal(result.offset, 11);
});

test('si todo se filtra no se publica precisión', () => {
  const result = computeClock({ samples: [sample(900, 1), sample(950, 2), sample(1000, 3)] });
  assert.equal(result.degraded, true);
  assert.equal(result.accuracy, null);
  assert.equal(result.samplesUsed, 0);
  assert.equal(result.minRtt, 900);
});

test('la mediana con número par promedia los centrales', () => {
  // RTTs dentro del filtro de 2x el mínimo (10 ms) para que pasen las cuatro.
  const result = computeClock({
    samples: [sample(10, 1), sample(12, 2), sample(14, 3), sample(16, 4)]
  });
  assert.equal(result.offset, 2.5);
  assert.equal(result.accuracy, 5);
});

test('quantile interpola y selectSamples devuelve el mínimo', () => {
  assert.equal(quantile([4, 1, 3, 2], 0.5), 2.5);
  const { usable, minRtt } = selectSamples([sample(120, 1), sample(30, 2), sample(50, 3)]);
  assert.equal(minRtt, 30);
  // 120 ms supera el doble del mínimo: se queda fuera aunque esté por debajo de 800.
  assert.deepEqual(
    usable.map((item) => item.rtt),
    [30, 50]
  );
});
