/*
 * hpa.test.js - tests for HPA* (src/pathfinding/hpa.js) and the benchmark
 * (src/pathfinding/benchmark.js).
 * Course concept: hierarchical pathfinding finds a path whenever A* does, and its
 * paths are close to optimal.
 * Agreed accuracy target: AVERAGE extra cost <= 10% (with the shortcut pass), and no
 * single query worse than 75% (short routes near entrances are the worst case).
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { generateMap } from '../src/world/mapGen.js';
import { createGrid, setTile } from '../src/world/grid.js';
import { TILE } from '../src/world/tiles.js';
import { findPath, pathCost, canStep } from '../src/pathfinding/astar.js';
import {
  buildAbstractGraph, hpaFindPath, refineNextSegment, refineFullPath,
} from '../src/pathfinding/hpa.js';
import { runPathBenchmark } from '../src/pathfinding/benchmark.js';

// Every step of a tile path must be a legal A* step (adjacent, walkable, no corner-cutting).
function assertValidTilePath(grid, path, start, goal) {
  assert.deepEqual(path[0], { x: start.x, y: start.y });
  assert.deepEqual(path[path.length - 1], { x: goal.x, y: goal.y });
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    assert.ok(Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0), 'steps must be adjacent');
    assert.ok(canStep(grid, path[i - 1].x, path[i - 1].y, dx, dy, () => true), 'illegal step');
  }
}

test('a short opening gets one entrance, a long opening gets two', () => {
  // 8 x 4 grass grid split into two 4 x 4 clusters: the shared border is 4 tiles long.
  const grid = createGrid(8, 4, TILE.GRASS);
  const oneEntrance = buildAbstractGraph(grid, 4, 6);  // 4 < 6: short opening
  assert.equal(oneEntrance.stats.entrances, 1);
  assert.equal(oneEntrance.nodes.length, 2);
  const twoEntrances = buildAbstractGraph(grid, 4, 3); // 4 >= 3: long opening
  assert.equal(twoEntrances.stats.entrances, 2);
  assert.equal(twoEntrances.nodes.length, 4);
});

test('a wall along a cluster border means no entrance and no path', () => {
  const grid = createGrid(8, 4, TILE.GRASS);
  for (let y = 0; y < 4; y++) {
    setTile(grid, 4, y, TILE.ROCK);
  }
  const graph = buildAbstractGraph(grid, 4, 6);
  assert.equal(graph.stats.entrances, 0);
  const route = hpaFindPath(graph, { x: 0, y: 0 }, { x: 7, y: 3 });
  assert.equal(route.found, false);
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 7, y: 3 }).path, null);
});

test('HPA* finds a path whenever A* does, within the agreed cost bounds (5 seeded maps)', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const map = generateMap(createRng(seed));
    const graph = buildAbstractGraph(map.grid);
    const result = runPathBenchmark(map.grid, graph, createRng(seed * 100), 40);
    assert.equal(result.hpaFailures, 0, 'seed ' + seed);
    assert.ok(result.averageExtraCostPercent <= 10, 'seed ' + seed + ' average ' + result.averageExtraCostPercent);
    assert.ok(result.worstExtraCostPercent <= 75, 'seed ' + seed + ' worst ' + result.worstExtraCostPercent);
    assert.ok(result.hpa.abstractNodes < result.astar.nodes, 'abstract search should be smaller');
  }
});

test('refined HPA* paths are legal tile paths with the reported cost', () => {
  const map = generateMap(createRng(9));
  const graph = buildAbstractGraph(map.grid);
  const start = { x: 2, y: 2 };
  const goal = { x: 93, y: 60 };
  const route = hpaFindPath(graph, start, goal);
  assert.equal(route.found, true);
  const path = refineFullPath(graph, route);
  assertValidTilePath(map.grid, path, start, goal);
  assert.ok(Math.abs(pathCost(map.grid, path) - route.cost) < 1e-6);
  // The shortcut pass may only make the path cheaper, never more expensive.
  const astar = findPath(map.grid, start, goal);
  assert.ok(route.cost >= astar.cost - 1e-9, 'cannot beat the optimum');
});

test('refinement is lazy: one segment per call', () => {
  const map = generateMap(createRng(9));
  const graph = buildAbstractGraph(map.grid);
  const route = hpaFindPath(graph, { x: 2, y: 2 }, { x: 93, y: 60 });
  assert.ok(route.segments.length > 2);
  assert.equal(route.stats.refinedTileNodes, 0, 'nothing refined before asking');

  const first = refineNextSegment(route);
  assert.equal(route.nextSegment, 1);
  assert.equal(route.stats.refinedTileNodes, first.length);

  let count = 1;
  while (refineNextSegment(route) !== null) {
    count += 1;
  }
  assert.equal(count, route.segments.length);
});

test('the route cache is shared by queries between the same two clusters', () => {
  const map = generateMap(createRng(9));
  const graph = buildAbstractGraph(map.grid);
  const first = hpaFindPath(graph, { x: 2, y: 30 }, { x: 93, y: 30 }, { useCache: true });
  assert.equal(first.stats.fromCache, false);
  const second = hpaFindPath(graph, { x: 3, y: 31 }, { x: 92, y: 29 }, { useCache: true });
  assert.equal(second.stats.fromCache, true);
  assert.equal(second.stats.abstractNodesExpanded, 0);
  assertValidTilePath(map.grid, refineFullPath(graph, second), { x: 3, y: 31 }, { x: 92, y: 29 });
});
