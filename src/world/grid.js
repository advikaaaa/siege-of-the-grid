/*
 * grid.js - the tile grid data structure and basic queries on it.
 * Course concept: the search space for pathfinding. A* sees the map as a graph
 * where every walkable tile is a node and neighbouring tiles are connected.
 * Used by: world/mapGen.js, movement/*, pathfinding/*, ai/*, game/gameWorld.js,
 * render/mapRenderer.js, the scenes and the tests.
 *
 * Pure logic: no DOM or canvas, so it can be unit-tested in Node.
 *
 * Storage: a 2D grid stored in a 1D Uint8Array, row by row ("row-major"):
 *     index = y * width + x
 * WHY: one flat typed array is compact (1 byte per tile) and every tile has a
 * single number as its id, which pathfinding uses as a node id.
 */

import { MAP } from '../config.js';
import { TILE_INFO } from './tiles.js';

export function createGrid(width, height, fillTileType) {
  const tiles = new Uint8Array(width * height);
  tiles.fill(fillTileType);
  return { width: width, height: height, tiles: tiles };
}

export function tileIndex(grid, x, y) {
  return y * grid.width + x;
}

export function inBounds(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function getTile(grid, x, y) {
  return grid.tiles[tileIndex(grid, x, y)];
}

export function setTile(grid, x, y, tileType) {
  grid.tiles[tileIndex(grid, x, y)] = tileType;
}

// Outside the map counts as NOT walkable, so callers never need a separate
// bounds check before asking "can I step here?".
export function isWalkable(grid, x, y) {
  if (!inBounds(grid, x, y)) {
    return false;
  }
  return TILE_INFO[getTile(grid, x, y)].walkable;
}

// Cost of ENTERING this tile (grass 1, forest 3, blocked Infinity).
export function tileCost(grid, x, y) {
  if (!inBounds(grid, x, y)) {
    return Infinity;
  }
  return TILE_INFO[getTile(grid, x, y)].cost;
}

// ---- Pixels <-> tiles --------------------------------------------------------
// Agents live in continuous PIXEL space; the map lives in discrete TILE space.
//   tile  = floor(pixel / tileSize)
//   centre of tile in pixels = tile * tileSize + tileSize / 2

export function pixelToTile(pixel) {
  return Math.floor(pixel / MAP.tileSize);
}

export function tileCenterPixel(tile) {
  return tile * MAP.tileSize + MAP.tileSize / 2;
}

export function isWalkableAtPixel(grid, point) {
  return isWalkable(grid, pixelToTile(point.x), pixelToTile(point.y));
}
