/*
 * steering.test.js - tests for movement: steering behaviors (src/movement/steering.js),
 * kinematic movement (src/movement/kinematic.js) and the Agent physics step
 * (src/movement/agent.js).
 * Course concept: kinematic vs steering movement; each behavior's formula.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEERING } from '../src/config.js';
import { vec, length } from '../src/core/vector.js';
import { Agent } from '../src/movement/agent.js';
import { kinematicSeek } from '../src/movement/kinematic.js';
import {
  seek, flee, arrive, predictPosition, separation, obstacleAvoidance,
  formationSlotPosition, combinePrioritized,
} from '../src/movement/steering.js';
import { createGrid, setTile } from '../src/world/grid.js';
import { TILE } from '../src/world/tiles.js';

const TAU = STEERING.timeToTarget;

// Compares two numbers with a small tolerance (floating point is not exact).
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, (message ?? '') + ' expected ' + expected + ', got ' + actual);
}

function makeAgent(x, y, maxSpeed = 10) {
  return new Agent({ position: vec(x, y), maxSpeed: maxSpeed, maxForce: 1000, mass: 1, radius: 4 });
}

test('seek from rest points at the target with magnitude maxSpeed / timeToTarget', () => {
  const agent = makeAgent(0, 0, 10);
  const force = seek(agent, vec(100, 0));
  assertClose(force.x, 10 / TAU, 'x');
  assertClose(force.y, 0, 'y');
});

test('seek is zero when already moving at the desired velocity', () => {
  const agent = makeAgent(0, 0, 10);
  agent.velocity = vec(0, 10);
  const force = seek(agent, vec(0, 500));
  assertClose(length(force), 0);
});

test('flee points away from the threat inside the panic radius', () => {
  const agent = makeAgent(0, 0, 10);
  const force = flee(agent, vec(5, 0), 100);
  assert.ok(force.x < 0);
  assertClose(force.y, 0);
});

test('arrive inside the slowing radius asks for a proportionally smaller speed', () => {
  const agent = makeAgent(0, 0, 10);
  // distance 5, slowing radius 10 -> desired speed = 10 * 5 / 10 = 5
  const force = arrive(agent, vec(5, 0), 10);
  assertClose(force.x, 5 / TAU, 'x');
});

test('arrive outside the slowing radius behaves like seek', () => {
  const agent = makeAgent(0, 0, 10);
  const force = arrive(agent, vec(50, 0), 10);
  assertClose(force.x, 10 / TAU);
});

test('arrive on the target brakes against the current velocity', () => {
  const agent = makeAgent(0, 0, 10);
  agent.velocity = vec(3, 0);
  const force = arrive(agent, vec(0, 0), 10);
  assertClose(force.x, -3 / TAU);
});

test('pursue prediction uses T = distance / maxSpeed, capped by maxPredictionTime', () => {
  const agent = makeAgent(0, 0, 50);
  // distance 100, maxSpeed 50 -> T = 2 s; target moves (0, 10) -> predicted (100, 20)
  const uncapped = predictPosition(agent, vec(100, 0), vec(0, 10), 5);
  assertClose(uncapped.x, 100);
  assertClose(uncapped.y, 20);
  // with a cap of 1 s -> predicted (100, 10)
  const capped = predictPosition(agent, vec(100, 0), vec(0, 10), 1);
  assertClose(capped.y, 10);
});

test('separation follows an inverse-square law', () => {
  const agent = makeAgent(0, 0);
  const near = separation(agent, [agent, makeAgent(2, 0)]);
  const far = separation(agent, [agent, makeAgent(4, 0)]);
  assert.ok(near.x < 0, 'pushes away (to the left)');
  // Half the distance -> four times the force.
  assertClose(near.x / far.x, 4);
});

test('obstacle avoidance pushes back from a wall straight ahead', () => {
  // Rock column at tile x = 5 (pixels 60..71). Agent in tile 4 heading right.
  const grid = createGrid(10, 10, TILE.GRASS);
  for (let y = 0; y < 10; y++) {
    setTile(grid, 5, y, TILE.ROCK);
  }
  const agent = makeAgent(54, 60, 70);
  agent.velocity = vec(70, 0);
  agent.heading = 0;
  const force = obstacleAvoidance(agent, grid);
  assert.ok(force.x < 0, 'force should point away from the wall, got ' + force.x);
});

test('formation slot offsets rotate with the leader heading', () => {
  // Leader at origin facing +y (heading 90 degrees). A slot 10 px BEHIND the
  // leader (offset x = -10) must end up at (0, -10).
  const slot = formationSlotPosition(vec(0, 0), Math.PI / 2, vec(-10, 0));
  assertClose(slot.x, 0);
  assertClose(slot.y, -10);
});

test('combinePrioritized serves high-priority forces first and truncates the rest', () => {
  const total = combinePrioritized([
    { name: 'avoid', force: vec(0, 60), weight: 1 },
    { name: 'seek', force: vec(100, 0), weight: 1 },
  ], 100);
  // avoid takes 60 of the budget of 100, seek only gets the remaining 40.
  assertClose(total.y, 60);
  assertClose(total.x, 40);
});

test('agent integrates a = F/m, v += a dt, p += v dt', () => {
  const agent = new Agent({ position: vec(0, 0), maxSpeed: 100, mass: 2 });
  agent.applySteeringForce(vec(10, 0), 1, null);
  // a = 10 / 2 = 5, v = 0 + 5 * 1 = 5, p = 0 + 5 * 1 = 5
  assertClose(agent.velocity.x, 5);
  assertClose(agent.position.x, 5);
});

test('agent velocity is clamped to maxSpeed', () => {
  const agent = new Agent({ position: vec(0, 0), maxSpeed: 3, mass: 1 });
  agent.applySteeringForce(vec(1000, 0), 1, null);
  assertClose(length(agent.velocity), 3);
});

test('kinematic seek moves at exactly maxSpeed and lands on the target', () => {
  const agent = makeAgent(0, 0, 10);
  const far = kinematicSeek(agent, vec(0, 100), 0.1);
  assertClose(length(far), 10, 'constant speed');
  // 0.5 px away with maxSpeed * dt = 1 px: land exactly this step.
  const close = kinematicSeek(agent, vec(0.5, 0), 0.1);
  agent.applyKinematicVelocity(close, 0.1, null);
  assertClose(agent.position.x, 0.5);
});
