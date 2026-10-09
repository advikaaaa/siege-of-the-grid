/*
 * reservations.test.js - tests for time-aware bridge planning
 * (src/pathfinding/reservations.js and the crossing planner in pathService.js).
 * Course concept: continuous-time planning at chokepoints; overlap detection.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalsOverlap, ReservationTable, chooseCrossing } from '../src/pathfinding/reservations.js';
import { PathService } from '../src/pathfinding/pathService.js';
import { buildAbstractGraph } from '../src/pathfinding/hpa.js';
import { generateMap } from '../src/world/mapGen.js';
import { createRng } from '../src/core/rng.js';

test('interval overlap detection', () => {
  assert.equal(intervalsOverlap(0, 5, 3, 8), true);   // partly overlapping
  assert.equal(intervalsOverlap(0, 10, 2, 3), true);  // one inside the other
  assert.equal(intervalsOverlap(0, 5, 5, 8), false);  // touching ends do not overlap
  assert.equal(intervalsOverlap(6, 8, 0, 5), false);  // fully separate
});

test('load counts the sizes of all overlapping reservations', () => {
  const table = new ReservationTable([0], 6);
  table.reserve(0, 1, 0, 10, 4);
  table.reserve(0, 2, 5, 15, 1);
  table.reserve(0, 3, 20, 30, 6);
  assert.equal(table.loadDuring(0, 6, 8), 5);
  assert.equal(table.loadDuring(0, 16, 18), 0);
});

test('a full bridge makes you wait until a reservation ends', () => {
  const table = new ReservationTable([0], 2);
  table.reserve(0, 1, 0, 10, 2); // full from 0 to 10
  assert.equal(table.earliestStart(0, 5, 3, 1), 10);
  assert.equal(table.expectedWait(0, 5, 3, 1), 5);
  assert.equal(table.expectedWait(0, 12, 3, 1), 0); // after it, no wait
});

test('releasing a reservation frees the bridge', () => {
  const table = new ReservationTable([0], 1);
  const reservation = table.reserve(0, 1, 0, 10, 1);
  assert.equal(table.expectedWait(0, 0, 2, 1), 10);
  table.release(reservation);
  assert.equal(table.expectedWait(0, 0, 2, 1), 0);
});

test('old reservations expire', () => {
  const table = new ReservationTable([0], 1);
  table.reserve(0, 1, 0, 10, 1);
  table.expire(25, 10); // ended at 10, now 25, keep 10 s -> gone
  assert.equal(table.reservationsFor(0).length, 0);
});

test('choose the bridge with the smallest travel + wait', () => {
  const choice = chooseCrossing([
    { bridgeId: 0, travelTime: 20, wait: 8 },  // closest but busy: 28
    { bridgeId: 1, travelTime: 24, wait: 0 },  // detour, free: 24
    { bridgeId: 2, travelTime: 40, wait: 0 },
  ]);
  assert.equal(choice.chosen.bridgeId, 1);
  assert.equal(choice.preferred.bridgeId, 0);
});

// ---- The planner inside the path service -----------------------------------------

function fakeUnit(id, tile) {
  return { id: id, kind: 'enemy', alive: true, agent: { maxSpeed: 50, currentTile: () => tile } };
}

function makeService(seed, capacity) {
  const map = generateMap(createRng(seed));
  const table = new ReservationTable(map.bridges.map((b) => b.id), capacity);
  const service = new PathService({
    grid: map.grid,
    hpaGraph: buildAbstractGraph(map.grid),
    bridges: map.bridges,
    riverLeft: map.riverLeft,
    reservations: table,
  });
  return { map, table, service };
}

test('a crossing route reserves a slot on a bridge', () => {
  const { table, service } = makeService(12345, 6);
  let route = null;
  service.requestRoute(fakeUnit(1, { x: 92, y: 32 }), { x: 7, y: 32 }, (r) => { route = r; }, { crossing: true, groupSize: 6 });
  service.update(0);
  assert.notEqual(route, null);
  assert.ok(route.crossing !== undefined, 'route should carry crossing info');
  assert.equal(table.reservationsFor(route.crossing.reservation.bridgeId).length, 1);
});

test('a second full squad at the same moment waits or takes another bridge', () => {
  const { service } = makeService(12345, 6);
  const routes = [];
  for (let id = 1; id <= 2; id++) {
    service.requestRoute(fakeUnit(id, { x: 92, y: 32 }), { x: 7, y: 32 }, (r) => routes.push(r), { crossing: true, groupSize: 6 });
  }
  service.update(0);
  const first = routes[0].crossing;
  const second = routes[1].crossing;
  const otherBridge = second.reservation.bridgeId !== first.reservation.bridgeId;
  const waits = second.reservation.start >= first.reservation.end - 1e-9;
  assert.ok(otherBridge || waits, 'the second squad must not share the full slot');
});
