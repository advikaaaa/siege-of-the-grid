/*
 * rng.js - seeded pseudo-random number generator (PRNG).
 * Course concept: supports "uncertainty" in decision making (weighted random
 * choices) while keeping every demo REPRODUCIBLE. Math.random() cannot be seeded,
 * so two runs would differ; with our own generator, the same seed gives exactly
 * the same map and the same AI dice rolls every time.
 * Used by: world/mapGen.js, scenes/gameScene.js, and later movement (wander),
 * ai/decision.js, game/waves.js, the AI Lab benchmark.
 *
 * Algorithm: Linear Congruential Generator (LCG), constants from "Numerical Recipes":
 *
 *     state(n+1) = (1664525 * state(n) + 1013904223)  mod 2^32
 *     output     = state / 2^32          -> a number in [0, 1)
 *
 * WHY an LCG: it is the simplest PRNG that is good enough for a game, and it can
 * be explained in one line. It is NOT good enough for cryptography or serious
 * statistics (consecutive values are slightly correlated); fancier generators
 * such as mulberry32 or xorshift fix that, but we do not need them here.
 */

const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const TWO_POW_32 = 4294967296; // 2^32

export function createRng(seed) {
  // ">>> 0" converts any number to an unsigned 32-bit integer (0 .. 2^32 - 1).
  let state = seed >>> 0;

  // Returns a float in [0, 1).
  function next() {
    // Math.imul multiplies as 32-bit integers, which is exactly what the LCG
    // needs. A plain "*" would produce numbers too big to be represented
    // exactly as a JavaScript double. The final ">>> 0" is the "mod 2^32".
    state = (Math.imul(MULTIPLIER, state) + INCREMENT) >>> 0;
    return state / TWO_POW_32;
  }

  // Float in [min, max)
  function range(min, max) {
    return min + next() * (max - min);
  }

  // Integer in [min, max], both ends INCLUDED.
  function int(min, max) {
    return Math.floor(range(min, max + 1));
  }

  // true with probability p (0..1). Example: chance(0.3) is true 30% of the time.
  function chance(probability) {
    return next() < probability;
  }

  // A random element of a non-empty array.
  function pick(array) {
    return array[int(0, array.length - 1)];
  }

  // "Random binomial": next() - next(), a number in (-1, 1) where values near 0
  // are more likely than values near -1 or 1 (a triangle-shaped distribution).
  // Used by wander so that small turns are common and sharp turns are rare.
  function binomial() {
    return next() - next();
  }

  return {
    seed: seed,
    next: next,
    range: range,
    int: int,
    chance: chance,
    pick: pick,
    binomial: binomial,
  };
}
