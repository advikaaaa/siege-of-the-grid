/*
 * mapGen.js - procedural map generation from a seed + connectivity check.
 * Course concept: the environment NPCs move through. Weighted tiles (forest) and
 * chokepoints (3 bridges over the river) are what make pathfinding, HPA* and
 * bridge reservations interesting. The flood fill guarantees that every walkable
 * tile can reach every other one, so A* never fails because of a sealed-off pocket.
 * Used by: game/gameWorld.js, scenes/aiLabScene.js, scenes/menuScene.js,
 * tests/hpa.test.js, tests/mapGen.test.js, tests/reservations.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * Steps for one candidate map:
 *   1. Fill everything with grass.
 *   2. Choose the rows of the 3 bridges.
 *   3. Carve a 3-tile-wide river from top to bottom that drifts left/right.
 *      It does not drift inside a bridge, so each bridge is a clean rectangle.
 *   4. Turn the river tiles of each bridge into bridge tiles.
 *   5. Grow rock blobs and forest blobs with random walks, avoiding the
 *      protected areas (base, enemy spawn edge, bridge approaches).
 *   6. Flood fill: if any walkable tile is unreachable, throw the map away and
 *      generate another one (the RNG has moved on, so the next map is different).
 */

import { MAP, MAPGEN, BASE } from '../config.js';
import { TILE } from './tiles.js';
import { createGrid, getTile, setTile, isWalkable, tileIndex } from './grid.js';

// Up, down, left, right. Used both for random walks and for the flood fill.
const FOUR_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// Returns { grid, bridges, riverLeft, base, attempts }.
// bridges: array of { id, left, right, top, bottom } in tile coordinates (inclusive).
// riverLeft[y]: leftmost water/bridge column on row y (tells which side of the
// river a tile is on; used by the bridge planner in pathService.js).
export function generateMap(rng) {
  for (let attempt = 1; attempt <= MAPGEN.maxAttempts; attempt++) {
    const map = buildCandidateMap(rng);
    if (isFullyConnected(map.grid)) {
      map.attempts = attempt;
      return map;
    }
  }
  throw new Error('Could not generate a connected map in ' + MAPGEN.maxAttempts + ' attempts');
}

function buildCandidateMap(rng) {
  const grid = createGrid(MAP.widthTiles, MAP.heightTiles, TILE.GRASS);
  const bridgeTopRows = chooseBridgeRows(rng);
  const riverLeft = carveRiver(grid, rng, bridgeTopRows);
  const bridges = buildBridges(grid, riverLeft, bridgeTopRows);

  growBlobs(grid, rng, TILE.ROCK, MAPGEN.rockBlobCount, MAPGEN.rockBlobSteps, bridges);
  growBlobs(grid, rng, TILE.FOREST, MAPGEN.forestBlobCount, MAPGEN.forestBlobSteps, bridges);

  return { grid: grid, bridges: bridges, riverLeft: riverLeft, base: BASE, attempts: 0 };
}

// ---- Bridges and river -------------------------------------------------------

// Bridges are spread evenly: row = height * (i + 1) / (count + 1)
// For 64 rows and 3 bridges that is rows 16, 32, 48, each moved by a random jitter.
function chooseBridgeRows(rng) {
  const topRows = [];
  for (let i = 0; i < MAPGEN.bridgeCount; i++) {
    const evenRow = Math.round((MAP.heightTiles * (i + 1)) / (MAPGEN.bridgeCount + 1));
    const jitter = rng.int(-MAPGEN.bridgeJitter, MAPGEN.bridgeJitter);
    topRows.push(evenRow + jitter);
  }
  return topRows;
}

// True for the 2nd (and later) rows of a bridge. The river must not shift on
// these rows, otherwise the bridge would not be a straight rectangle.
function continuesBridge(bridgeTopRows, y) {
  for (const top of bridgeTopRows) {
    const bottom = top + MAPGEN.bridgeHeight - 1;
    if (y > top && y <= bottom) {
      return true;
    }
  }
  return false;
}

// Carves the river and returns riverLeft[y] = leftmost water column on row y.
function carveRiver(grid, rng, bridgeTopRows) {
  const riverLeft = [];
  const centreLeft = MAPGEN.riverCenterX - Math.floor(MAPGEN.riverWidth / 2);
  let left = centreLeft;

  for (let y = 0; y < grid.height; y++) {
    const mayShift = y > 0 && !continuesBridge(bridgeTopRows, y);
    if (mayShift && rng.chance(MAPGEN.riverShiftChance)) {
      const shifted = left + rng.pick([-1, 1]);
      // Stay within riverMaxDrift tiles of the centre so the river stays "in the middle".
      if (Math.abs(shifted - centreLeft) <= MAPGEN.riverMaxDrift) {
        left = shifted;
      }
    }
    // A shift of only 1 tile per row keeps the water rows overlapping, so the
    // river never has a diagonal gap that a unit could slip through.
    riverLeft.push(left);
    for (let x = left; x < left + MAPGEN.riverWidth; x++) {
      setTile(grid, x, y, TILE.WATER);
    }
  }
  return riverLeft;
}

function buildBridges(grid, riverLeft, bridgeTopRows) {
  const bridges = [];
  for (let i = 0; i < bridgeTopRows.length; i++) {
    const top = bridgeTopRows[i];
    const bottom = top + MAPGEN.bridgeHeight - 1;
    const left = riverLeft[top];
    const right = left + MAPGEN.riverWidth - 1;

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        setTile(grid, x, y, TILE.BRIDGE);
      }
    }
    bridges.push({ id: i, left: left, right: right, top: top, bottom: bottom });
  }
  return bridges;
}

// ---- Obstacles ---------------------------------------------------------------

// Areas where we never place rocks or forest.
function isProtected(grid, bridges, x, y) {
  if (x < MAPGEN.baseClearWidth) {
    return true; // around the player base
  }
  if (x >= grid.width - MAPGEN.spawnClearWidth) {
    return true; // enemy spawn edge
  }
  const clearance = MAPGEN.bridgeClearance;
  for (const bridge of bridges) {
    const nearX = x >= bridge.left - clearance && x <= bridge.right + clearance;
    const nearY = y >= bridge.top - 1 && y <= bridge.bottom + 1;
    if (nearX && nearY) {
      return true; // bridge approach, so bridges are always usable
    }
  }
  return false;
}

function growBlobs(grid, rng, tileType, blobCount, stepRange, bridges) {
  for (let i = 0; i < blobCount; i++) {
    const stepCount = rng.int(stepRange.min, stepRange.max);
    growOneBlob(grid, rng, tileType, stepCount, bridges);
  }
}

// Random walk: start somewhere random, paint the tile, step in a random direction,
// repeat. The walk often revisits tiles, which naturally makes compact,
// irregular blobs instead of straight lines.
function growOneBlob(grid, rng, tileType, stepCount, bridges) {
  let x = rng.int(0, grid.width - 1);
  let y = rng.int(0, grid.height - 1);

  for (let step = 0; step < stepCount; step++) {
    let canPaint = getTile(grid, x, y) === TILE.GRASS && !isProtected(grid, bridges, x, y);
    if (tileType === TILE.ROCK && touchesEdgeOrWater(grid, x, y)) {
      canPaint = false;
    }
    if (canPaint) {
      setTile(grid, x, y, tileType);
    }
    const direction = rng.pick(FOUR_DIRECTIONS);
    x = clamp(x + direction.x, 0, grid.width - 1);
    y = clamp(y + direction.y, 0, grid.height - 1);
  }
}

// Rocks may not touch the map edge or the river (including diagonally).
// WHY: a rock blob pressed against the edge or the riverbank easily seals off a
// small pocket of grass, which fails the connectivity check and forces a
// regeneration. Keeping that 1-tile corridor open makes valid maps far more likely.
function touchesEdgeOrWater(grid, x, y) {
  if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) {
    return true;
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (getTile(grid, x + dx, y + dy) === TILE.WATER) {
        return true;
      }
    }
  }
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---- Connectivity ------------------------------------------------------------

// Breadth-first flood fill over walkable tiles, starting from (startX, startY).
// Returns a Uint8Array with 1 for every reached tile.
//
// WHY 4 directions when units move in 8: we forbid corner-cutting, so a
// diagonal step is only legal when both orthogonal neighbours are walkable.
// That means any diagonal move can be replaced by two straight moves, so
// "connected with 4 directions" is exactly "connected for our units".
function floodFill(grid, startX, startY) {
  const reached = new Uint8Array(grid.width * grid.height);
  if (!isWalkable(grid, startX, startY)) {
    return reached;
  }

  const queue = [{ x: startX, y: startY }];
  reached[tileIndex(grid, startX, startY)] = 1;
  // We read the queue with a moving index instead of queue.shift(), because
  // shift() re-copies the whole array every time (slow for thousands of tiles).
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const direction of FOUR_DIRECTIONS) {
      const nx = current.x + direction.x;
      const ny = current.y + direction.y;
      if (isWalkable(grid, nx, ny) && reached[tileIndex(grid, nx, ny)] === 0) {
        reached[tileIndex(grid, nx, ny)] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return reached;
}

// The map is fully connected when a flood fill from ANY walkable tile reaches
// EVERY walkable tile.
export function isFullyConnected(grid) {
  const start = findFirstWalkable(grid);
  if (start === null) {
    return false; // a map with nowhere to walk is useless
  }
  const reached = floodFill(grid, start.x, start.y);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isWalkable(grid, x, y) && reached[tileIndex(grid, x, y)] === 0) {
        return false;
      }
    }
  }
  return true;
}

function findFirstWalkable(grid) {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isWalkable(grid, x, y)) {
        return { x: x, y: y };
      }
    }
  }
  return null;
}
