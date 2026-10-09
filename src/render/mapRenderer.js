/*
 * mapRenderer.js - draws the tile map and the player base on the canvas.
 * Course concept: none directly; it makes the environment (tile costs,
 * chokepoints) visible so the pathfinding demos make sense.
 * Used by: scenes/gameScene.js (and later the AI Lab).
 *
 * We redraw every tile every frame (96 x 64 = 6144 small rectangles). That is
 * cheap enough for a modern browser, so we keep it simple and do not cache.
 */

import { MAP } from '../config.js';
import { TILE_INFO } from '../world/tiles.js';
import { getTile } from '../world/grid.js';

export function drawMap(ctx, map) {
  const size = MAP.tileSize;
  const grid = map.grid;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      ctx.fillStyle = TILE_INFO[getTile(grid, x, y)].color;
      // Tile (x, y) covers pixels [x * size, (x + 1) * size) horizontally.
      ctx.fillRect(x * size, y * size, size, size);
    }
  }

  // The AI Lab arena has no base (map.base is null).
  if (map.base !== null) {
    drawBase(ctx, map.base);
  }
}

// The base is only an outline for now; it gets HP and gameplay in P5.
function drawBase(ctx, base) {
  const size = MAP.tileSize;
  ctx.strokeStyle = '#f2d14b';
  ctx.lineWidth = 2;
  ctx.strokeRect(base.x * size, base.y * size, base.width * size, base.height * size);
  ctx.fillStyle = '#f2d14b';
  ctx.font = '10px sans-serif';
  ctx.fillText('BASE', base.x * size, base.y * size - 3);
}

// White outline around one tile, used to show the tile under the mouse.
export function drawTileHighlight(ctx, tileX, tileY) {
  const size = MAP.tileSize;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  // +0.5 puts a 1px line exactly on pixel centres so it looks sharp.
  ctx.strokeRect(tileX * size + 0.5, tileY * size + 0.5, size - 1, size - 1);
}
