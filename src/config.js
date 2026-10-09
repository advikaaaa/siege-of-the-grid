/*
 * config.js - every tunable number in the game, in one place.
 * Course concept: supports all of them. Keeping numbers here (instead of scattered
 * through the code) lets us tune behaviour and explain it without hunting for
 * "magic numbers". Later phases add steering weights, unit stats and waves here.
 * Used by: almost every file (main.js, core/loop.js, world/mapGen.js, render/*, scenes/*).
 */

// ---- Map size -------------------------------------------------------------
// 96 x 64 tiles of 12 px = a 1152 x 768 canvas.
// 96 and 64 are both multiples of 16, so the map splits cleanly into
// 16 x 16 HPA* clusters later: 96/16 = 6 columns, 64/16 = 4 rows = 24 clusters.
export const MAP = {
  widthTiles: 96,
  heightTiles: 64,
  tileSize: 12,
};

// ---- Game loop ------------------------------------------------------------
export const LOOP = {
  // Fixed timestep: the simulation always advances in steps of 1/60 s,
  // no matter how fast or slow the screen refreshes.
  updatesPerSecond: 60,
  // If the tab was hidden or the computer stalled, we would owe the simulation
  // hundreds of steps. We cap the catch-up at 0.25 s to avoid the
  // "spiral of death" (falling further behind because catching up is slow).
  maxFrameSeconds: 0.25,
};

// Seed used when the URL has no ?seed= parameter. The same seed always produces
// the same map and the same AI dice rolls, so demos are reproducible.
export const DEFAULT_SEED = 12345;

// ---- Player base (in tiles) -----------------------------------------------
// A rectangle on the left edge, vertically centred.
export const BASE = {
  x: 2,
  y: 29,
  width: 4,
  height: 6,
};

// ---- Map generation ---------------------------------------------------------
export const MAPGEN = {
  // The river: 3 tiles wide, centred near the middle column, drifting left and
  // right a little so it looks natural.
  riverWidth: 3,
  riverCenterX: 48,
  riverMaxDrift: 4,          // how far (tiles) the river may wander from the centre
  riverShiftChance: 0.3,     // chance per row that the river shifts by 1 tile

  // Exactly 3 bridges, each 2 tiles tall, roughly at 1/4, 2/4 and 3/4 of the height.
  bridgeCount: 3,
  bridgeHeight: 2,
  bridgeJitter: 3,           // random vertical offset (+/- tiles) for each bridge
  bridgeClearance: 3,        // keep this many tiles around bridge ends free of rocks/forest

  // Areas kept free of obstacles so the base and the enemy spawn are reachable.
  baseClearWidth: 12,        // columns 0..11 on the left
  spawnClearWidth: 6,        // last 6 columns on the right

  // Obstacles are grown as "blobs" with a random walk (see mapGen.js).
  rockBlobCount: 45,
  rockBlobSteps: { min: 8, max: 25 },
  forestBlobCount: 35,
  forestBlobSteps: { min: 20, max: 50 },

  // If a generated map is not fully connected we throw it away and try again.
  // Measured over 200 seeds: about 6 attempts on average, 42 at worst, ~4 ms each.
  maxAttempts: 300,
};
