/*
 * difficulty.js - Easy / Normal / Hard, and the predictable vs uncertain AI mode.
 * Course concept: DIFFICULTY SCALING without cheating. "Enemies get smarter, not
 * stronger": difficulty changes ONLY how the enemy thinks and perceives:
 *   - reaction time      (pause in DECIDE before acting: 0.8 / 0.5 / 0.25 s)
 *   - squad coordination (Normal: squad shares its target; Hard: also pincer
 *                         flanking, squad members alternate left/right)
 *   - repositioning likelihood (how often the dice pick REPOSITION)
 *   - sight range        (how far enemies notice defenders)
 * HP and damage are the same on every difficulty (see UNIT_STATS in config.js).
 * Used by: game/gameWorld.js (builds world.aiSettings), scenes (labels).
 *
 * Pure logic: no DOM or canvas.
 */

import { chooseEngagementAction, predictableAction } from './decision.js';

export const DIFFICULTIES = {
  EASY: {
    label: 'Easy',
    reactionTime: 0.8,
    sharedTargets: false,
    coordinatedFlanking: false,
    decisionWeights: { ATTACK: 0.85, REPOSITION: 0.05, RETREAT: 0.1 },
    sightMultiplier: 0.8,
  },
  NORMAL: {
    label: 'Normal',
    reactionTime: 0.5,
    sharedTargets: true,
    coordinatedFlanking: false,
    decisionWeights: { ATTACK: 0.7, REPOSITION: 0.2, RETREAT: 0.1 }, // the spec's defaults
    sightMultiplier: 1.0,
  },
  HARD: {
    label: 'Hard',
    reactionTime: 0.25,
    sharedTargets: true,
    coordinatedFlanking: true,
    decisionWeights: { ATTACK: 0.55, REPOSITION: 0.35, RETREAT: 0.1 },
    sightMultiplier: 1.25,
  },
};

export const DIFFICULTY_NAMES = ['EASY', 'NORMAL', 'HARD'];
export const AI_MODES = ['UNCERTAIN', 'PREDICTABLE'];

// Builds the settings object the enemy brain reads (world.aiSettings):
// {
//   difficultyName, aiMode, reactionTime, sightMultiplier, sharedTargets,
//   chooseAction(rng, unit, world)  -> 'ATTACK' | 'REPOSITION' | 'RETREAT'
//   chooseFlankSide(rng, unit)      -> +1 or -1
// }
// The brain never needs to know WHICH difficulty or mode is active.
export function buildAiSettings(difficultyName, aiMode) {
  const difficulty = DIFFICULTIES[difficultyName];
  const predictable = aiMode === 'PREDICTABLE';
  return {
    difficultyName: difficultyName,
    aiMode: aiMode,
    reactionTime: difficulty.reactionTime,
    sightMultiplier: difficulty.sightMultiplier,
    sharedTargets: difficulty.sharedTargets,

    chooseAction(rng, unit, world) {
      if (predictable) {
        return predictableAction(unit, world);
      }
      return chooseEngagementAction(rng, difficulty.decisionWeights);
    },

    chooseFlankSide(rng, unit) {
      if (predictable) {
        return 1; // ALWAYS the same side: easy to learn, easy to exploit
      }
      if (difficulty.coordinatedFlanking && unit.squad !== null) {
        // Pincer: squad members alternate sides, so the target is hit from both.
        return unit.squad.members.indexOf(unit) % 2 === 0 ? 1 : -1;
      }
      return rng.chance(0.5) ? 1 : -1;
    },
  };
}
