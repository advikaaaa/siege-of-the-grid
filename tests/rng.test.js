/*
 * rng.test.js - tests for the seeded random number generator (src/core/rng.js).
 * Course concept: reproducibility of AI behaviour (uncertainty you can replay).
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';

function firstValues(rng, count) {
  const values = [];
  for (let i = 0; i < count; i++) {
    values.push(rng.next());
  }
  return values;
}

test('same seed gives the same sequence', () => {
  const a = firstValues(createRng(42), 100);
  const b = firstValues(createRng(42), 100);
  assert.deepEqual(a, b);
});

test('different seeds give different sequences', () => {
  const a = firstValues(createRng(1), 20);
  const b = firstValues(createRng(2), 20);
  assert.notDeepEqual(a, b);
});

test('next() stays in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 10000; i++) {
    const value = rng.next();
    assert.ok(value >= 0 && value < 1, 'value out of range: ' + value);
  }
});

test('int(min, max) is inclusive and hits every value', () => {
  const rng = createRng(99);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const value = rng.int(3, 6);
    assert.ok(Number.isInteger(value) && value >= 3 && value <= 6);
    seen.add(value);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('chance(p) is true roughly p of the time', () => {
  const rng = createRng(2024);
  let hits = 0;
  const trials = 10000;
  for (let i = 0; i < trials; i++) {
    if (rng.chance(0.3)) {
      hits += 1;
    }
  }
  const ratio = hits / trials;
  assert.ok(ratio > 0.27 && ratio < 0.33, 'ratio was ' + ratio);
});
