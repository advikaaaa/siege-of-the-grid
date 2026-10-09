/*
 * decision.js - uncertain decisions: weighted random choice with the seeded RNG.
 * Course concept: UNCERTAINTY in decision making. If an enemy always reacted the
 * same way, the player would learn it and exploit it. Rolling a weighted die
 * (ATTACK 70%, REPOSITION 20%, RETREAT 10%) keeps it believable but unpredictable,
 * while the seeded RNG keeps every demo reproducible.
 * Used by: ai/enemyBrain.js (DECIDE state), tests/fsm.test.js.
 *
 * Pure logic: no DOM or canvas.
 */

// options: [{ value, weight }] with weight >= 0 (they do not need to sum to 1).
//
// Imagine the weights laid end to end on a number line:
//     ATTACK [0, 0.7)  REPOSITION [0.7, 0.9)  RETREAT [0.9, 1.0)
// Roll a number in [0, total) and return the option whose interval contains it.
export function weightedChoice(rng, options) {
  let total = 0;
  for (const option of options) {
    total += option.weight;
  }
  const roll = rng.next() * total;
  let cumulative = 0;
  for (const option of options) {
    cumulative += option.weight;
    if (roll < cumulative) {
      return option.value;
    }
  }
  // Only reachable through floating-point rounding: return the last option.
  return options[options.length - 1].value;
}

// weights = { ATTACK, REPOSITION, RETREAT } (see config.js, AI.decisionWeights)
export function chooseEngagementAction(rng, weights) {
  return weightedChoice(rng, [
    { value: 'ATTACK', weight: weights.ATTACK },
    { value: 'REPOSITION', weight: weights.REPOSITION },
    { value: 'RETREAT', weight: weights.RETREAT },
  ]);
}
