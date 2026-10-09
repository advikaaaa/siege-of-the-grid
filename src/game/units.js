/*
 * units.js - creates the game's units: a unit = an Agent body + game data.
 * Course concept: the NPC itself. Each unit has a body (Agent: physics and
 * movement), a movement ORDER (what unitMovement.js should do), combat stats,
 * and, for allies and enemies, a BRAIN (a state machine from ai/).
 * Used by: game/gameWorld.js.
 */

import { UNIT_STATS, AI } from '../config.js';
import { Agent } from '../movement/agent.js';
import { idleOrder } from '../movement/unitMovement.js';

const COLORS = { commander: '#3a86ff', ally: '#8ecae6', enemy: '#e63946' };
const TEAMS = { commander: 'player', ally: 'player', enemy: 'enemy' };

// kind: 'commander' | 'ally' | 'enemy'
export function createUnit(id, kind, position) {
  const stats = UNIT_STATS[kind];
  return {
    id: id,
    kind: kind,
    team: TEAMS[kind],
    color: COLORS[kind],
    agent: new Agent({ position: position, maxSpeed: stats.maxSpeed, radius: stats.radius }),

    maxHp: stats.maxHp,
    hp: stats.maxHp,
    damage: stats.damage,
    attackRange: stats.attackRange,
    attackCooldown: stats.attackCooldown,
    cooldownTimer: 0,
    sightRange: stats.sightRange,
    alive: true,

    order: idleOrder(),  // current movement order (movement/unitMovement.js)
    brain: null,         // StateMachine for allies and enemies (ai/)
    target: null,        // the unit we are fighting

    // Brains "think" (look around) only every AI.thinkInterval seconds. Starting
    // timers differ per unit (staggering), so not everyone thinks in the same step.
    thinkTimer: (id % 10) * (AI.thinkInterval / 10),
    thinksThisStep: false,

    squad: null,         // enemies: the squad they belong to (game/squads.js)
    slotIndex: 0,        // allies: which formation slot is theirs
    spawnTile: null,     // enemies: where to retreat to
    waitingForPath: false,
    catchUpTimer: 0,
    flankPoint: null,

    rawPath: null,       // Commander: last raw A* tile path (overlay 1, orange)
  };
}

// HP as a fraction 0..1, used for the 30% / 70% thresholds and HP bars.
export function hpFraction(unit) {
  return unit.hp / unit.maxHp;
}
