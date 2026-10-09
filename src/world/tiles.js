/*
 * tiles.js - the tile types of the map and their properties.
 * Course concept: pathfinding on a WEIGHTED grid. Each tile has a movement cost;
 * A* and HPA* add up these costs, so units prefer grass over forest, and rock and
 * water are impassable.
 * Used by: world/grid.js, world/mapGen.js, render/mapRenderer.js,
 * scenes/gameScene.js, the AI Lab and the tests.
 *
 * Tile types are small integers so the whole map fits in one Uint8Array
 * (1 byte per tile, see grid.js).
 */

export const TILE = {
  GRASS: 0,
  FOREST: 1,
  ROCK: 2,
  WATER: 3,
  BRIDGE: 4,
};

// Indexed by tile type: TILE_INFO[TILE.FOREST].cost === 3.
// Blocked tiles have cost Infinity, so any path through them would have infinite cost.
export const TILE_INFO = [
  { name: 'Grass', cost: 1, walkable: true, color: '#5a8f3c' },
  { name: 'Forest', cost: 3, walkable: true, color: '#2f5e2a' },
  { name: 'Rock', cost: Infinity, walkable: false, color: '#7d7d7d' },
  { name: 'Water', cost: Infinity, walkable: false, color: '#3b6fb6' },
  { name: 'Bridge', cost: 1, walkable: true, color: '#a0703c' },
];
