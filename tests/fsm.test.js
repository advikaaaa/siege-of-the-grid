/*
 * fsm.test.js - tests for decision making: the generic FSM (src/ai/fsm.js), the
 * enemy and ally transition tables and brains, weighted random decisions
 * (src/ai/decision.js) and formation shapes (src/movement/formations.js).
 * Course concept: FSM transitions, uncertainty, formations.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine } from '../src/ai/fsm.js';
import { ENEMY_TRANSITIONS } from '../src/ai/enemyBrain.js';
import { ALLY_TRANSITIONS } from '../src/ai/allyBrain.js';
import { weightedChoice, chooseEngagementAction } from '../src/ai/decision.js';
import { formationOffsets } from '../src/movement/formations.js';
import { GameWorld } from '../src/game/gameWorld.js';
import { createRng } from '../src/core/rng.js';
import { vec } from '../src/core/vector.js';

// A tiny two-state machine that records which hooks ran.
function makeLightSwitch(log) {
  return new StateMachine('Switch', {
    initial: 'OFF',
    states: {
      OFF: {
        enter() { log.push('enter OFF'); },
        update() { return log.includes('press') ? 'PRESS' : null; },
        exit() { log.push('exit OFF'); },
      },
      ON: {
        enter() { log.push('enter ON'); },
      },
    },
    transitions: { OFF: { PRESS: 'ON' }, ON: { PRESS: 'OFF' } },
  });
}

test('FSM runs enter, then exit + enter on a transition', () => {
  const log = [];
  const fsm = makeLightSwitch(log);
  fsm.update(0.1);
  assert.equal(fsm.current, 'OFF');
  log.push('press');
  fsm.update(0.1);
  assert.equal(fsm.current, 'ON');
  assert.equal(fsm.previous, 'OFF');
  assert.deepEqual(log, ['enter OFF', 'press', 'exit OFF', 'enter ON']);
});

test('FSM resets timeInState on every transition', () => {
  const fsm = makeLightSwitch([]);
  fsm.update(0.5);
  fsm.update(0.5);
  assert.equal(fsm.timeInState, 1);
  fsm.send('PRESS');
  assert.equal(fsm.timeInState, 0);
});

test('FSM throws on an event that is not in the transition table', () => {
  const fsm = makeLightSwitch([]);
  fsm.start();
  assert.equal(fsm.canHandle('EXPLODE'), false);
  assert.throws(() => fsm.send('EXPLODE'));
});

test('enemy transition table contains every transition from the design', () => {
  assert.equal(ENEMY_TRANSITIONS.MARCH.ENEMY_SEEN, 'DECIDE');
  assert.equal(ENEMY_TRANSITIONS.MARCH.REACHED_BASE, 'SIEGE');
  assert.equal(ENEMY_TRANSITIONS.DECIDE.CHOSE_ATTACK, 'ATTACK');
  assert.equal(ENEMY_TRANSITIONS.DECIDE.CHOSE_REPOSITION, 'REPOSITION');
  assert.equal(ENEMY_TRANSITIONS.DECIDE.CHOSE_RETREAT, 'RETREAT');
  assert.equal(ENEMY_TRANSITIONS.ATTACK.HP_LOW, 'RETREAT');
  assert.equal(ENEMY_TRANSITIONS.RETREAT.HP_RECOVERED, 'REGROUP');
  assert.equal(ENEMY_TRANSITIONS.REGROUP.REGROUPED, 'MARCH');
});

test('every transition table only points at states that exist', () => {
  for (const table of [ENEMY_TRANSITIONS, ALLY_TRANSITIONS]) {
    for (const row of Object.values(table)) {
      for (const target of Object.values(row)) {
        assert.ok(target in table, target + ' is not a state');
      }
    }
  }
});

// ---- Brains inside a real (headless) game world ------------------------------------

function worldWithOneEnemy() {
  const world = new GameWorld(1, { movementMode: 'steering' });
  world.spawnSquad(1);
  const enemy = world.enemyUnits()[0];
  return { world, enemy };
}

test('an enemy with HP below 30% retreats', () => {
  const { world, enemy } = worldWithOneEnemy();
  world.update(1 / 60);
  assert.equal(enemy.brain.current, 'MARCH');
  enemy.hp = enemy.maxHp * 0.2;
  world.update(1 / 60);
  assert.equal(enemy.brain.current, 'RETREAT');
});

test('an enemy that sees a defender decides after its reaction time, then attacks', () => {
  const { world, enemy } = worldWithOneEnemy();
  world.aiSettings.chooseAction = () => 'ATTACK'; // make the dice deterministic for this test
  // Put an ally right next to the enemy.
  const ally = world.units.find((unit) => unit.kind === 'ally');
  ally.agent.position = vec(enemy.agent.position.x - 20, enemy.agent.position.y);

  // The enemy starts in MARCH and sees the ally on its very first update, so we
  // record the states from then on and count how long DECIDE lasted.
  const states = [];
  let decideSteps = 0;
  for (let i = 0; i < 90; i++) {
    world.update(1 / 60);
    if (enemy.brain.current === 'DECIDE') {
      decideSteps += 1;
    }
    if (states[states.length - 1] !== enemy.brain.current) {
      states.push(enemy.brain.current);
    }
  }
  assert.deepEqual(states.slice(0, 2), ['DECIDE', 'ATTACK']);
  // It must hesitate for the reaction time (0.5 s = 30 steps) before acting.
  assert.ok(decideSteps / 60 >= world.aiSettings.reactionTime - 1e-9, 'decided too fast: ' + decideSteps + ' steps');
});

test('allies switch to GUARD when G is pressed and back to FOLLOW when pressed again', () => {
  const world = new GameWorld(1, { movementMode: 'steering' });
  const ally = world.units.find((unit) => unit.kind === 'ally');
  world.update(1 / 60);
  assert.equal(ally.brain.current, 'FOLLOW');
  world.toggleGuard();
  world.update(1 / 60);
  assert.equal(ally.brain.current, 'GUARD');
  world.toggleGuard();
  world.update(1 / 60);
  assert.equal(ally.brain.current, 'FOLLOW');
});

// ---- Uncertain decisions -------------------------------------------------------------

test('weighted choice follows the weights (70 / 20 / 10)', () => {
  const rng = createRng(77);
  const counts = { ATTACK: 0, REPOSITION: 0, RETREAT: 0 };
  const trials = 20000;
  for (let i = 0; i < trials; i++) {
    counts[chooseEngagementAction(rng, { ATTACK: 0.7, REPOSITION: 0.2, RETREAT: 0.1 })] += 1;
  }
  assert.ok(Math.abs(counts.ATTACK / trials - 0.7) < 0.02);
  assert.ok(Math.abs(counts.REPOSITION / trials - 0.2) < 0.02);
  assert.ok(Math.abs(counts.RETREAT / trials - 0.1) < 0.02);
});

test('a zero weight is never chosen', () => {
  const rng = createRng(5);
  for (let i = 0; i < 1000; i++) {
    assert.notEqual(weightedChoice(rng, [{ value: 'a', weight: 1 }, { value: 'b', weight: 0 }]), 'b');
  }
});

// ---- Formations ---------------------------------------------------------------------

test('formation shapes give one distinct slot per member', () => {
  for (const name of ['LINE', 'V', 'BOX']) {
    const offsets = formationOffsets(name, 8, 10);
    assert.equal(offsets.length, 8);
    const unique = new Set(offsets.map((o) => o.x + ',' + o.y));
    assert.equal(unique.size, 8, name + ' has overlapping slots');
  }
});

test('LINE is centred behind the leader, BOX surrounds the leader', () => {
  const line = formationOffsets('LINE', 3, 10);
  assert.deepEqual(line.map((o) => o.y), [-10, 0, 10]);
  assert.ok(line.every((o) => o.x < 0), 'all behind the leader');
  const box = formationOffsets('BOX', 8, 10);
  const sumX = box.reduce((sum, o) => sum + o.x, 0);
  const sumY = box.reduce((sum, o) => sum + o.y, 0);
  assert.equal(sumX, 0);
  assert.equal(sumY, 0);
});
