const test = require('node:test');
const assert = require('node:assert/strict');
const { solve, evaluate } = require('../src/solver.js');

const close = (actual, expected, tol = 1e-6, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${msg || ''} expected ${expected}, got ${actual}`);

test('simply supported, central point load', () => {
  const L = 6, P = 10, EI = 10000;
  const r = solve({ length: L, support: { type: 'simple', a: 0, b: L }, loads: [{ kind: 'point', x: 3, P }], EI });
  assert.ok(r.ok);
  close(r.reactions[0].F, 5);
  close(r.reactions[1].F, 5);
  close(r.summary.maxM.value, (P * L) / 4);
  close(r.summary.maxM.x, 3);
  close(r.summary.minY.value, -(P * L ** 3) / (48 * EI), 1e-4);
});

test('simply supported, full UDL', () => {
  const L = 8, w = 5, EI = 20000;
  const r = solve({ length: L, support: { type: 'simple', a: 0, b: L }, loads: [{ kind: 'udl', x1: 0, x2: L, w1: w, w2: w }], EI });
  close(r.reactions[0].F, 20);
  close(r.summary.maxM.value, (w * L * L) / 8);
  close(r.summary.maxM.x, 4);
  close(r.summary.minY.value, -(5 * w * L ** 4) / (384 * EI), 1e-4);
});

test('simply supported, triangular load: Mmax = wL²/(9√3)', () => {
  const L = 9, w = 6;
  const r = solve({ length: L, support: { type: 'simple', a: 0, b: L }, loads: [{ kind: 'udl', x1: 0, x2: L, w1: 0, w2: w }] });
  close(r.reactions[0].F, (w * L) / 6);
  close(r.reactions[1].F, (w * L) / 3);
  close(r.summary.maxM.value, (w * L * L) / (9 * Math.sqrt(3)), 1e-8);
  close(r.summary.maxM.x, L / Math.sqrt(3), 1e-8);
});

test('cantilever fixed left, tip load', () => {
  const L = 4, P = 12, EI = 5000;
  const r = solve({ length: L, support: { type: 'cantilever-left' }, loads: [{ kind: 'point', x: L, P }], EI });
  close(r.reactions[0].F, P);
  close(r.reactions[0].M, -P * L); // counter-clockwise (hogging) fixed-end moment
  close(r.summary.minM.value, -P * L);
  close(r.summary.minM.x, 0);
  close(r.summary.minY.value, -(P * L ** 3) / (3 * EI), 1e-4);
  close(r.summary.minY.x, L);
});

test('cantilever fixed right, UDL', () => {
  const L = 3, w = 4, EI = 8000;
  const r = solve({ length: L, support: { type: 'cantilever-right' }, loads: [{ kind: 'udl', x1: 0, x2: L, w1: w, w2: w }], EI });
  close(r.reactions[0].F, w * L);
  close(r.summary.minM.value, -(w * L * L) / 2);
  close(r.summary.minM.x, L);
  close(r.summary.minY.value, -(w * L ** 4) / (8 * EI), 1e-4);
  close(r.summary.minY.x, 0);
});

test('applied moment on simply supported beam', () => {
  const L = 10, M0 = 20;
  const r = solve({ length: L, support: { type: 'simple', a: 0, b: L }, loads: [{ kind: 'moment', x: 4, M: M0 }] });
  // Clockwise couple: R1 down, R2 up
  close(r.reactions[0].F, -2);
  close(r.reactions[1].F, 2);
  close(evaluate(r, 4 - 1e-6).M, -8, 1e-5);
  close(evaluate(r, 4).M, 12, 1e-6);
});

test('overhanging beam', () => {
  // Supports at 0 and 6, beam to 8, point load 10 at tip
  const r = solve({ length: 8, support: { type: 'simple', a: 0, b: 6 }, loads: [{ kind: 'point', x: 8, P: 10 }] });
  close(r.reactions[0].F, -10 / 3);
  close(r.reactions[1].F, 40 / 3);
  close(r.summary.minM.value, -20);
  close(r.summary.minM.x, 6);
  close(evaluate(r, 8).M, 0);
});

test('equilibrium: moment and shear return to zero at the free end', () => {
  const r = solve({
    length: 7,
    support: { type: 'simple', a: 1, b: 6 },
    loads: [
      { kind: 'point', x: 0, P: 3 },
      { kind: 'udl', x1: 2, x2: 5, w1: 2, w2: 6 },
      { kind: 'moment', x: 3.5, M: -4 },
      { kind: 'point', x: 7, P: 5 },
    ],
  });
  const last = r.points[r.points.length - 1];
  close(last.V, 0, 1e-9);
  close(last.M, 0, 1e-9);
});

test('validation errors', () => {
  const r = solve({ length: 5, support: { type: 'simple', a: 2, b: 2 }, loads: [{ kind: 'point', x: 9, P: 1 }] });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});
