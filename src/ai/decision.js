/*
 * decision.js - uncertain decisions: weighted random choice with the seeded RNG.
 * Course concept: UNCERTAINTY in decision making. If an enemy always reacted the
 * same way, the player would learn it and exploit it. Rolling a weighted die
 * (ATTACK 70%, REPOSITION 20%, RETREAT 10%) keeps it believable but unpredictable,
 * while the seeded RNG keeps every demo reproducible.
 * It also holds the PREDICTABLE rule set used for the complexity-fallacy demo.
 * Used by: ai/difficulty.js (which the enemy brain's DECIDE state calls), tests/fsm.test.js.
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

// weights = { ATTACK, REPOSITION, RETREAT } (per difficulty, see ai/difficulty.js)
export function chooseEngagementAction(rng, weights) {
  return weightedChoice(rng, [
    { value: 'ATTACK', weight: weights.ATTACK },
    { value: 'REPOSITION', weight: weights.REPOSITION },
    { value: 'RETREAT', weight: weights.RETREAT },
  ]);
}

// ---------------------------------------------------------------------------------
// PREDICTABLE RULES (the P key) - the "complexity fallacy" demo.
//
// The same decision as above, made by fixed if-then rules instead of dice:
//   1. The Commander's HP is below 30%      -> ATTACK (go for the kill)
//   2. My own HP is below 50%               -> RETREAT
//   3. Otherwise                            -> REPOSITION (always to the same side)
//
// Why this is EXPLOITABLE: a player only needs to see each rule fire once to know
// exactly what every enemy will do. Keep the Commander above 30% HP and no enemy
// ever commits to a plain attack; hurt an enemy to half HP and it always walks
// away; and every flank arrives on the same, known side, so you can stand where
// that side is blocked by rock or covered by your allies.
//
// Why MORE RULES would not fix it (the complexity fallacy): adding rule 4, 5, 6...
// makes the rule set more complicated for the DESIGNER, but for the player it is
// still a fixed table from situation to action. Each new rule is just one more
// thing to learn, and rules start to interact in ways that create new holes.
// Complexity is not the same as unpredictability. A small amount of well-placed
// randomness (the weighted dice above) gives believable, varied behaviour with
// LESS logic, while the seeded RNG keeps it reproducible for testing.
// ---------------------------------------------------------------------------------
export function predictableAction(unit, world) {
  const commander = world.commander;
  if (commander.alive && commander.hp / commander.maxHp < 0.3) {
    return 'ATTACK';
  }
  if (unit.hp / unit.maxHp < 0.5) {
    return 'RETREAT';
  }
  return 'REPOSITION';
}
