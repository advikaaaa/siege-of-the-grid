/*
 * allyBrain.js - the allied soldiers' decision making, as a finite state machine.
 * Course concept: DECISION MAKING (FSM) for friendly NPCs.
 * Used by: game/gameWorld.js (each of the 8 allies gets one brain).
 *
 * STATES:
 *   FOLLOW - keep my formation slot around the Commander (F changes the shape)
 *   ENGAGE - chase and hit an enemy I can see
 *   GUARD  - keep my slot around the guard point in front of the base (G key)
 *
 *   FOLLOW --enemy seen--> ENGAGE --enemy dead/lost or leash broken--> FOLLOW
 *   FOLLOW --G pressed--> GUARD --enemy near the base--> ENGAGE --done--> GUARD
 *   GUARD  --G pressed again--> FOLLOW
 *
 * Pure logic: no DOM or canvas.
 */

import { AI } from '../config.js';
import { distance } from '../core/vector.js';
import { StateMachine } from './fsm.js';
import { findVisibleEnemy } from './perception.js';
import { keepSlotOrCatchUp } from './formationKeeping.js';
import { arriveOrder } from '../movement/unitMovement.js';
import { tryAttackUnit } from '../game/combat.js';

export const ALLY_TRANSITIONS = {
  FOLLOW: { ENEMY_SEEN: 'ENGAGE', GUARD_ORDERED: 'GUARD' },
  ENGAGE: { DONE_FOLLOW: 'FOLLOW', DONE_GUARD: 'GUARD' },
  GUARD: { ENEMY_SEEN: 'ENGAGE', REJOIN_ORDERED: 'FOLLOW' },
};

// world must provide: grid, guardMode, base, commander, enemyUnits(),
// commanderAnchor(), guardAnchor(), allySlotOffset(unit), requestPath(...).
export function createAllyBrain(unit, world) {
  function isTargetGone() {
    const target = unit.target;
    if (target === null || !target.alive) {
      return true;
    }
    return distance(unit.agent.position, target.agent.position) > AI.loseTargetDistance;
  }

  // Do not chase enemies forever: stay near the Commander (or the guard point).
  function isLeashBroken() {
    if (world.guardMode) {
      return distance(unit.agent.position, world.base.guardPoint) > AI.guardRadius * 1.5;
    }
    const commander = world.commander;
    return commander.alive && distance(unit.agent.position, commander.agent.position) > AI.allyLeashDistance;
  }

  function lookForEnemy() {
    return findVisibleEnemy(unit, world.enemyUnits(), world.grid, unit.sightRange);
  }

  // HYSTERESIS: only START a chase if the enemy is well inside the leash
  // (engageWithinLeashFraction of it). Without this gap, an ally chases an enemy
  // to the leash limit, turns back, sees it again, chases again... and flips
  // FOLLOW <-> ENGAGE every few frames (we measured 600+ flips in 3 minutes).
  function isWorthChasing(enemy) {
    const commander = world.commander;
    if (!commander.alive) {
      return true;
    }
    const limit = AI.allyLeashDistance * AI.engageWithinLeashFraction;
    return distance(enemy.agent.position, commander.agent.position) <= limit;
  }

  const states = {
    FOLLOW: {
      enter() {
        unit.target = null;
      },
      update(dt) {
        if (world.guardMode) {
          return 'GUARD_ORDERED';
        }
        if (unit.thinksThisStep) {
          const seen = lookForEnemy();
          if (seen !== null && isWorthChasing(seen)) {
            unit.target = seen;
            return 'ENEMY_SEEN';
          }
        }
        const isStillFollowing = () => brain.current === 'FOLLOW';
        keepSlotOrCatchUp(unit, world, () => world.commanderAnchor(), world.allySlotOffset(unit), dt, isStillFollowing);
        return null;
      },
    },

    ENGAGE: {
      enter() {
        unit.order = arriveOrder(unit.target.agent.position, 4);
      },
      update() {
        if (isTargetGone() || isLeashBroken()) {
          return world.guardMode ? 'DONE_GUARD' : 'DONE_FOLLOW';
        }
        unit.order.point = unit.target.agent.position;
        tryAttackUnit(unit, unit.target);
        return null;
      },
    },

    GUARD: {
      enter() {
        unit.target = null;
      },
      update(dt) {
        if (!world.guardMode) {
          return 'REJOIN_ORDERED';
        }
        if (unit.thinksThisStep) {
          const seen = lookForEnemy();
          const nearBase = seen !== null && distance(seen.agent.position, world.base.guardPoint) <= AI.guardRadius;
          if (nearBase) {
            unit.target = seen;
            return 'ENEMY_SEEN';
          }
        }
        const isStillGuarding = () => brain.current === 'GUARD';
        keepSlotOrCatchUp(unit, world, () => world.guardAnchor(), world.allySlotOffset(unit), dt, isStillGuarding);
        return null;
      },
    },
  };

  const brain = new StateMachine('Ally', { initial: 'FOLLOW', states: states, transitions: ALLY_TRANSITIONS });
  return brain;
}
