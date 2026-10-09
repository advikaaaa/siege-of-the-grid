/*
 * spatialHash.test.js - tests for the spatial hash (src/core/spatialHash.js) and
 * the path service queue and cache (src/pathfinding/pathService.js).
 * Course concept: performance techniques for many NPCs must give the SAME answers
 * as the slow way, only faster.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialHash } from '../src/core/spatialHash.js';
import { createRng } from '../src/core/rng.js';
import { PathService } from '../src/pathfinding/pathService.js';
import { PERFORMANCE } from '../src/config.js';
import { createGrid } from '../src/world/grid.js';
import { TILE } from '../src/world/tiles.js';

test('radius queries return exactly what brute force returns', () => {
  const rng = createRng(11);
  const hash = new SpatialHash(24, 1152, 768);
  const points = [];
  for (let i = 0; i < 400; i++) {
    const point = { id: i, x: rng.range(0, 1152), y: rng.range(0, 768) };
    points.push(point);
    hash.insert(point, point);
  }
  for (let q = 0; q < 50; q++) {
    const centre = { x: rng.range(0, 1152), y: rng.range(0, 768) };
    const radius = rng.range(5, 100);
    const fromHash = hash.queryRadius(centre, radius).map((p) => p.id).sort((a, b) => a - b);
    const bruteForce = points
      .filter((p) => (p.x - centre.x) ** 2 + (p.y - centre.y) ** 2 <= radius * radius)
      .map((p) => p.id);
    assert.deepEqual(fromHash, bruteForce);
  }
});

test('a query checks far fewer points than brute force', () => {
  const rng = createRng(12);
  const hash = new SpatialHash(24, 1152, 768);
  for (let i = 0; i < 300; i++) {
    hash.insert(i, { x: rng.range(0, 1152), y: rng.range(0, 768) });
  }
  hash.queryRadius({ x: 500, y: 300 }, 18);
  assert.ok(hash.checksThisStep < 30, 'checked ' + hash.checksThisStep + ' of 300');
});

// ---- Path service ---------------------------------------------------------------

function makeService() {
  return new PathService({ grid: createGrid(30, 30, TILE.GRASS), hpaGraph: null, bridges: [], riverLeft: [], reservations: null });
}

function fakeUnit(id, kind = 'enemy') {
  return { id: id, kind: kind, alive: true, agent: { maxSpeed: 50, currentTile: () => ({ x: 0, y: 0 }) } };
}

test('only a fixed budget of requests is answered per step (time slicing)', () => {
  const service = makeService();
  let answered = 0;
  for (let id = 1; id <= 10; id++) {
    service.requestPath(fakeUnit(id), { x: 20, y: id }, () => { answered += 1; });
  }
  service.update(0);
  assert.equal(answered, PERFORMANCE.pathRequestsPerStep);
  assert.equal(service.queuedCount(), 10 - PERFORMANCE.pathRequestsPerStep);
});

test('a newer request from the same unit replaces the older one', () => {
  const service = makeService();
  const unit = fakeUnit(1);
  const results = [];
  service.requestPath(unit, { x: 5, y: 5 }, (path) => results.push(path === null ? 'cancelled' : 'old'));
  service.requestPath(unit, { x: 9, y: 9 }, (path) => results.push(path === null ? 'none' : 'new'));
  service.update(0);
  assert.deepEqual(results, ['cancelled', 'new']);
});

test('the Commander jumps the queue', () => {
  const service = makeService();
  const order = [];
  for (let id = 1; id <= 8; id++) {
    service.requestPath(fakeUnit(id), { x: 20, y: id }, () => order.push(id));
  }
  service.requestPath(fakeUnit(99, 'commander'), { x: 3, y: 3 }, () => order.push(99));
  service.update(0);
  assert.equal(order[0], 99);
});

test('identical queries are answered from the cache', () => {
  const service = makeService();
  service.requestPath(fakeUnit(1), { x: 20, y: 20 }, () => {});
  service.update(0);
  service.requestPath(fakeUnit(2), { x: 20, y: 20 }, () => {});
  service.update(0);
  assert.equal(service.stats.cacheHits, 1);
});
