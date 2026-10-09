/*
 * astar.test.js - tests for A* (src/pathfinding/astar.js) and path smoothing
 * (src/pathfinding/smoothing.js).
 * Course concept: A* returns OPTIMAL paths with an admissible heuristic; no
 * corner-cutting; smoothing keeps line of sight between waypoints.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, pathCost, canStep, stepCost, NEIGHBOR_OFFSETS } from '../src/pathfinding/astar.js';
import { smoothPath, hasLineOfSight } from '../src/pathfinding/smoothing.js';
import { createGrid, setTile, isWalkable } from '../src/world/grid.js';
import { TILE } from '../src/world/tiles.js';
import { createRng } from '../src/core/rng.js';

const SQRT2 = Math.SQRT2;

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (message ?? '') + ' expected ' + expected + ', got ' + actual);
}

// Builds a grid from strings: '.' grass, 'f' forest, '#' rock.
function gridFromRows(rows) {
  const grid = createGrid(rows[0].length, rows.length, TILE.GRASS);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === '#') setTile(grid, x, y, TILE.ROCK);
      if (rows[y][x] === 'f') setTile(grid, x, y, TILE.FOREST);
    }
  }
  return grid;
}

// Reference answer: plain Dijkstra (no heuristic, no heap, scan for the minimum).
// Slow but obviously correct, so it is a good judge of A*'s optimality.
function dijkstraCost(grid, start, goal) {
  const allowAll = () => true;
  const dist = new Map();
  const done = new Set();
  const key = (x, y) => x + ',' + y;
  dist.set(key(start.x, start.y), 0);
  while (true) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const [k, d] of dist) {
      if (!done.has(k) && d < bestDist) {
        bestKey = k;
        bestDist = d;
      }
    }
    if (bestKey === null) return Infinity;
    if (bestKey === key(goal.x, goal.y)) return bestDist;
    done.add(bestKey);
    const [x, y] = bestKey.split(',').map(Number);
    for (const o of NEIGHBOR_OFFSETS) {
      if (!canStep(grid, x, y, o.dx, o.dy, allowAll)) continue;
      const k = key(x + o.dx, y + o.dy);
      const d = bestDist + stepCost(grid, x, y, o.dx, o.dy);
      if (!dist.has(k) || d < dist.get(k)) dist.set(k, d);
    }
  }
}

test('straight and diagonal costs on an open grid', () => {
  const grid = gridFromRows(['.....', '.....', '.....', '.....', '.....']);
  assertClose(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }).cost, 4);
  assertClose(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }).cost, 4 * SQRT2);
  // 3 diagonal + 1 straight
  assertClose(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 3 }).cost, 3 * SQRT2 + 1);
});

test('A* takes a detour when it is cheaper than walking through forest', () => {
  // Straight through the 3 forest tiles costs 3 + 3 + 3 + 1 = 10.
  // The detour over the top row of grass costs 2*sqrt(2) + 2 = 4.83.
  const grid = gridFromRows([
    '.....',
    '.fff.',
    '.....',
  ]);
  const result = findPath(grid, { x: 0, y: 1 }, { x: 4, y: 1 });
  // Optimal: diagonal up, 2 straight on row 0, diagonal down = 2*sqrt2 + 2
  assertClose(result.cost, 2 * SQRT2 + 2);
  assert.ok(!result.path.some((t) => t.y === 1 && t.x >= 1 && t.x <= 3), 'should avoid the forest');
});

test('A* returns null when the goal is unreachable', () => {
  const grid = gridFromRows([
    '..#..',
    '..#..',
    '..#..',
  ]);
  const result = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 2 });
  assert.equal(result.path, null);
  assert.equal(result.cost, Infinity);
});

test('A* returns null when the goal tile is blocked', () => {
  const grid = gridFromRows(['..#']);
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 }).path, null);
});

test('start equal to goal gives a one-tile path of cost 0', () => {
  const grid = gridFromRows(['...']);
  const result = findPath(grid, { x: 1, y: 0 }, { x: 1, y: 0 });
  assert.deepEqual(result.path, [{ x: 1, y: 0 }]);
  assert.equal(result.cost, 0);
});

test('no corner-cutting between two diagonal rocks', () => {
  // Rocks at (1,1) and (2,2) touch only at their corners.
  const grid = gridFromRows([
    '....',
    '.#..',
    '..#.',
    '....',
  ]);
  // Direct diagonal (1,2) -> (2,1) would pass between the rocks at (1,1) and (2,2).
  assert.equal(canStep(grid, 1, 2, 1, -1, () => true), false);

  const result = findPath(grid, { x: 0, y: 3 }, { x: 3, y: 0 });
  assert.notEqual(result.path, null);
  for (let i = 1; i < result.path.length; i++) {
    const a = result.path[i - 1];
    const b = result.path[i];
    if (a.x !== b.x && a.y !== b.y) {
      assert.ok(isWalkable(grid, b.x, a.y) && isWalkable(grid, a.x, b.y),
        'diagonal step ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b) + ' cuts a corner');
    }
  }
});

test('A* matches Dijkstra on 40 random seeded grids (optimality)', () => {
  const rng = createRng(2025);
  for (let trial = 0; trial < 40; trial++) {
    const grid = createGrid(12, 12, TILE.GRASS);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const roll = rng.next();
        if (roll < 0.2) setTile(grid, x, y, TILE.ROCK);
        else if (roll < 0.4) setTile(grid, x, y, TILE.FOREST);
      }
    }
    setTile(grid, 0, 0, TILE.GRASS);
    setTile(grid, 11, 11, TILE.GRASS);
    const expected = dijkstraCost(grid, { x: 0, y: 0 }, { x: 11, y: 11 });
    const result = findPath(grid, { x: 0, y: 0 }, { x: 11, y: 11 });
    if (expected === Infinity) {
      assert.equal(result.path, null, 'trial ' + trial);
    } else {
      assertClose(result.cost, expected, 'trial ' + trial);
      assertClose(pathCost(grid, result.path), expected, 'path cost trial ' + trial);
    }
  }
});

test('A* reports search statistics', () => {
  const grid = gridFromRows(['.....', '.....']);
  const result = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 1 });
  assert.ok(result.nodesExpanded >= result.path.length);
  assert.ok(result.timeMs >= 0);
});

test('smoothing an open-field path leaves only start and goal', () => {
  const grid = createGrid(20, 20, TILE.GRASS);
  const raw = findPath(grid, { x: 1, y: 1 }, { x: 18, y: 7 }).path;
  const smoothed = smoothPath(grid, raw, 4);
  assert.deepEqual(smoothed, [{ x: 1, y: 1 }, { x: 18, y: 7 }]);
});

test('smoothed waypoints always have line of sight to each other', () => {
  const grid = gridFromRows([
    '..........',
    '....#.....',
    '....#.....',
    '....#.....',
    '..........',
  ]);
  const raw = findPath(grid, { x: 0, y: 2 }, { x: 9, y: 2 }).path;
  const smoothed = smoothPath(grid, raw, 4);
  assert.ok(smoothed.length < raw.length);
  assert.ok(smoothed.length >= 3, 'must bend around the wall');
  for (let i = 1; i < smoothed.length; i++) {
    assert.ok(hasLineOfSight(grid, smoothed[i - 1], smoothed[i], 4));
  }
});

test('line of sight is blocked by rocks and by more expensive terrain', () => {
  const rock = gridFromRows(['..#..']);
  assert.equal(hasLineOfSight(rock, { x: 0, y: 0 }, { x: 4, y: 0 }, 0), false);
  const forest = gridFromRows(['..f..']);
  assert.equal(hasLineOfSight(forest, { x: 0, y: 0 }, { x: 4, y: 0 }, 0), false);
  const open = gridFromRows(['.....']);
  assert.equal(hasLineOfSight(open, { x: 0, y: 0 }, { x: 4, y: 0 }, 0), true);
});
