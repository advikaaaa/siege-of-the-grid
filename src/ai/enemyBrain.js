/*
 * enemyBrain.js - the enemy's decision making, as a finite state machine.
 * Course concept: DECISION MAKING (FSM), CLEAR GOALS and UNCERTAINTY.
 * Used by: game/gameWorld.js (every enemy gets one brain).
 *
 * GOAL CHAIN: attack the base -> fight defenders in the way -> retreat when
 * heavily damaged.
 *
 * STATES AND TRANSITIONS (also in ENEMY_TRANSITIONS below):
 *
 *   MARCH --sees a defender--> DECIDE --(after reaction time, weighted dice)--+
 *     |  \                                                                  |
 *     |   \--reaches base--> SIEGE           ATTACK 70% <-------------------+
 *     |                                      REPOSITION 20% (flank, then ATTACK)
 *     |                                      RETREAT 10%
 *   ATTACK / REPOSITION / SIEGE / MARCH --HP < 30%--> RETREAT
 *   RETREAT (run to spawn, evade threats, regenerate) --HP > 70%--> REGROUP
 *   REGROUP (rejoin the squad leader) --> MARCH
 *   DECIDE / ATTACK / REPOSITION --target dead or lost--> MARCH
 *
 * ------------------------------------------------------------------------------
 * THE SAME LOGIC AS A BEHAVIOR TREE (for comparison):
 *
 *   Selector                          (try children in order, first success wins)
 *   |-- Sequence                      (all children must succeed, in order)
 *   |     |-- Condition: HP < 30%?
 *   |     `-- Action: retreat to spawn and regenerate until HP > 70%
 *   |-- Sequence
 *   |     |-- Condition: next to the base?
 *   |     `-- Action: attack the base
 *   |-- Sequence
 *   |     |-- Condition: defender visible?
 *   |     |-- Action: wait reaction time
 *   |     `-- Random selector (70 / 20 / 10)
 *   |           |-- Action: attack target
 *   |           |-- Sequence: move to flank point -> attack target
 *   |           `-- Action: retreat
 *   `-- Action: march along the route to the base
 *
 * WHY WE CHOSE AN FSM: with 7 states the whole behaviour fits in one table that
 * we can draw and test (tests/fsm.test.js), and the current state is a single
 * word we can show above each unit (overlay 4). An FSM also naturally REMEMBERS
 * what it is doing (e.g. "I am retreating until HP > 70%"); a behavior tree
 * re-evaluates from the root each tick and needs extra memory for that.
 * Behavior trees win when behaviours get large and reusable (sub-trees can be
 * shared), which our small enemy does not need.
 * ------------------------------------------------------------------------------
 *
 * Pure logic: no DOM or canvas.
 */

import { AI, COMBAT } from '../config.js';
import { vec, add, scale, subtract, normalize, distance } from '../core/vector.js';
import { isWalkableAtPixel, pixelToTile } from '../world/grid.js';
import { StateMachine } from './fsm.js';
import { findVisibleEnemy, distanceToRect, hasClearLine } from './perception.js';
import { keepSlotOrCatchUp } from './formationKeeping.js';
import { idleOrder, arriveOrder, routeOrder, pathOrder, followerFromTiles, isOrderFinished } from '../movement/unitMovement.js';
import { tryAttackUnit, tryAttackBase } from '../game/combat.js';
import { siegePointFor } from '../game/base.js';
import { hpFraction } from '../game/units.js';
import { isLeader, squadAnchor, memberSlotOffset } from '../game/squads.js';

export const ENEMY_TRANSITIONS = {
  MARCH: { ENEMY_SEEN: 'DECIDE', REACHED_BASE: 'SIEGE', HP_LOW: 'RETREAT' },
  DECIDE: { CHOSE_ATTACK: 'ATTACK', CHOSE_REPOSITION: 'REPOSITION', CHOSE_RETREAT: 'RETREAT', TARGET_LOST: 'MARCH' },
  ATTACK: { HP_LOW: 'RETREAT', TARGET_LOST: 'MARCH' },
  REPOSITION: { IN_POSITION: 'ATTACK', HP_LOW: 'RETREAT', TARGET_LOST: 'MARCH' },
  RETREAT: { HP_RECOVERED: 'REGROUP' },
  REGROUP: { REGROUPED: 'MARCH' },
  SIEGE: { HP_LOW: 'RETREAT' },
};

// world must provide: grid, rng, base, opponentsNear(unit, radius),
// requestPath(unit, tile, callback), requestRoute(unit, tile, callback), and
// aiSettings = { reactionTime, chooseAction(rng, unit), chooseFlankSide(rng) }.
// HOW the enemy chooses (uncertain dice or predictable rules, P7) lives in
// aiSettings, so the state machine itself never changes.
export function createEnemyBrain(unit, world) {
  const grid = world.grid;

  // ---- Small questions the states ask ----------------------------------------
  function isHpLow() {
    return hpFraction(unit) < COMBAT.retreatBelowHpFraction;
  }

  function isTargetGone() {
    const target = unit.target;
    if (target === null || !target.alive) {
      return true;
    }
    return distance(unit.agent.position, target.agent.position) > AI.loseTargetDistance;
  }

  function lookForDefender() {
    return findVisibleEnemy(unit, world.opponentsNear(unit, unit.sightRange), grid, unit.sightRange);
  }

  // ---- MARCH ----------------------------------------------------------------
  function marchAsLeader() {
    const hasRoute = unit.order.type === 'route' && !isOrderFinished(unit.order);
    if (hasRoute || unit.waitingForPath) {
      return;
    }
    unit.waitingForPath = true;
    // The leader plans for the whole squad, including WHEN it crosses the river.
    const options = { crossing: true, groupSize: unit.squad.members.length };
    world.requestRoute(unit, world.base.frontTile, (route) => {
      unit.waitingForPath = false;
      if (route !== null && unit.alive && brain.current === 'MARCH') {
        unit.order = routeOrder(route, grid, unit.agent.radius);
      }
    }, options);
  }

  function marchAsMember(dt) {
    const isStillMarching = () => brain.current === 'MARCH';
    keepSlotOrCatchUp(unit, world, squadAnchor(unit.squad), memberSlotOffset(unit), dt, isStillMarching);
  }

  // ---- REPOSITION: a point to the side of the target ------------------------
  // Vector from the target to me, turned 90 degrees left or right (perpendicular
  // of (x, y) is (-y, x)), scaled to flankDistance and added to the target.
  function chooseFlankPoint() {
    const target = unit.target.agent.position;
    const towardsMe = normalize(subtract(unit.agent.position, target));
    const side = world.aiSettings.chooseFlankSide(world.rng);
    const sideways = vec(-towardsMe.y * side, towardsMe.x * side);
    const point = add(target, scale(sideways, AI.flankDistance));
    const reachable = isWalkableAtPixel(grid, point) && hasClearLine(grid, unit.agent.position, point);
    return reachable ? point : null;
  }

  // ---- The states ----------------------------------------------------------------
  const states = {
    MARCH: {
      enter() {
        unit.target = null;
        unit.order = idleOrder();
      },
      update(dt) {
        if (isHpLow()) {
          return 'HP_LOW';
        }
        if (distanceToRect(unit.agent.position, world.base.rect) < COMBAT.siegeDistance) {
          return 'REACHED_BASE';
        }
        if (unit.thinksThisStep) {
          const seen = lookForDefender();
          if (seen !== null) {
            unit.target = seen;
            return 'ENEMY_SEEN';
          }
        }
        if (isLeader(unit)) {
          marchAsLeader();
        } else {
          marchAsMember(dt);
        }
        return null;
      },
    },

    // Stand still for the reaction time, then roll the weighted dice.
    DECIDE: {
      enter() {
        unit.order = idleOrder();
      },
      update(dt, fsm) {
        if (isTargetGone()) {
          return 'TARGET_LOST';
        }
        if (fsm.timeInState < world.aiSettings.reactionTime) {
          return null;
        }
        const action = world.aiSettings.chooseAction(world.rng, unit);
        return 'CHOSE_' + action;
      },
    },

    ATTACK: {
      enter() {
        unit.order = arriveOrder(unit.target.agent.position, 4);
      },
      update() {
        if (isHpLow()) {
          return 'HP_LOW';
        }
        if (isTargetGone()) {
          return 'TARGET_LOST';
        }
        unit.order.point = unit.target.agent.position; // chase its current position
        tryAttackUnit(unit, unit.target);
        return null;
      },
    },

    REPOSITION: {
      enter() {
        unit.flankPoint = chooseFlankPoint();
        unit.order = unit.flankPoint !== null ? arriveOrder(unit.flankPoint, 8) : idleOrder();
      },
      update(dt, fsm) {
        if (isHpLow()) {
          return 'HP_LOW';
        }
        if (isTargetGone()) {
          return 'TARGET_LOST';
        }
        const arrived = unit.flankPoint === null || distance(unit.agent.position, unit.flankPoint) < 10;
        if (arrived || fsm.timeInState > AI.flankTimeout) {
          return 'IN_POSITION';
        }
        return null;
      },
    },

    // Run home along an HPA* route, dodging the nearest visible defender, and heal.
    RETREAT: {
      enter() {
        unit.target = null;
        unit.order = idleOrder();
        world.requestRoute(unit, unit.spawnTile, (route) => {
          if (route !== null && unit.alive && brain.current === 'RETREAT') {
            unit.order = routeOrder(route, grid, unit.agent.radius);
          }
        }, { crossing: true, groupSize: 1 });
      },
      update(dt, fsm) {
        unit.hp = Math.min(unit.maxHp, unit.hp + COMBAT.retreatRegenPerSecond * dt);
        if (unit.thinksThisStep) {
          unit.order.evadeFrom = lookForDefender();
        }
        const recovered = hpFraction(unit) > COMBAT.regroupAboveHpFraction;
        if (recovered && fsm.timeInState >= AI.minRetreatSeconds) {
          return 'HP_RECOVERED';
        }
        return null;
      },
    },

    // Walk back to the squad leader before marching again.
    REGROUP: {
      enter() {
        unit.order = idleOrder();
        unit.catchUpTimer = 0;
      },
      update(dt, fsm) {
        const leader = unit.squad.leader;
        const hasOtherLeader = leader !== unit && leader.alive;
        if (!hasOtherLeader || fsm.timeInState > AI.regroupTimeout) {
          return 'REGROUPED';
        }
        if (distance(unit.agent.position, leader.agent.position) < AI.regroupDistance) {
          return 'REGROUPED';
        }
        unit.catchUpTimer -= dt;
        if (unit.catchUpTimer <= 0 && !unit.waitingForPath) {
          unit.catchUpTimer = AI.catchUpReplanSeconds;
          unit.waitingForPath = true;
          const leaderTile = { x: pixelToTile(leader.agent.position.x), y: pixelToTile(leader.agent.position.y) };
          world.requestPath(unit, leaderTile, (tilePath) => {
            unit.waitingForPath = false;
            if (tilePath !== null && unit.alive && brain.current === 'REGROUP') {
              unit.order = pathOrder(followerFromTiles(grid, tilePath, unit.agent.radius));
            }
          });
        }
        return null;
      },
    },

    SIEGE: {
      enter() {
        unit.target = null;
        unit.order = arriveOrder(siegePointFor(world.base, unit.agent.position, unit.agent.radius), 6);
      },
      update() {
        if (isHpLow()) {
          return 'HP_LOW';
        }
        tryAttackBase(unit, world.base);
        return null;
      },
    },
  };

  const brain = new StateMachine('Enemy', { initial: 'MARCH', states: states, transitions: ENEMY_TRANSITIONS });
  return brain;
}
