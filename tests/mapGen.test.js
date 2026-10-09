/*
 * mapGen.test.js - tests for map generation and the flood-fill connectivity check
 * (src/world/mapGen.js).
 * Course concept: a valid search space for pathfinding (no unreachable pockets).
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/core/rng.js';
import { generateMap, isFullyConnected } from '../src/world/mapGen.js';
import { createGrid, setTile, getTile } from '../src/world/grid.js';
import { TILE } from '../src/world/tiles.js';

test('generated maps are fully connected and have exactly 3 bridges', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const map = generateMap(createRng(seed));
    assert.ok(isFullyConnected(map.grid), 'seed ' + seed + ' not connected');
    assert.equal(map.bridges.length, 3);
  }
});

test('the same seed generates the same map', () => {
  const a = generateMap(createRng(555));
  const b = generateMap(createRng(555));
  assert.deepEqual(a.grid.tiles, b.grid.tiles);
});

test('the river can only be crossed at bridges', () => {
  const map = generateMap(createRng(12345));
  const grid = map.grid;
  // Every row contains water or bridge tiles in the middle; rows with a bridge
  // must contain no water, and all other rows must contain water.
  for (let y = 0; y < grid.height; y++) {
    let hasWater = false;
    let hasBridge = false;
    for (let x = 0; x < grid.width; x++) {
      const tile = getTile(grid, x, y);
      if (tile === TILE.WATER) hasWater = true;
      if (tile === TILE.BRIDGE) hasBridge = true;
    }
    assert.ok(hasWater !== hasBridge, 'row ' + y + ' should have water XOR bridge');
  }
});

test('isFullyConnected detects a sealed-off pocket', () => {
  // 5x5 grass grid with a rock wall down column 2 -> two separate halves.
  const grid = createGrid(5, 5, TILE.GRASS);
  for (let y = 0; y < 5; y++) {
    setTile(grid, 2, y, TILE.ROCK);
  }
  assert.equal(isFullyConnected(grid), false);

  // Open one gap in the wall -> connected again.
  setTile(grid, 2, 2, TILE.GRASS);
  assert.equal(isFullyConnected(grid), true);
});
