/*
 * gameScene.js - the main game screen.
 * Course concept: this is where everything comes together. In P1 it only owns
 * the seeded RNG and the map; units, AI and overlays are added in later phases.
 * Used by: main.js (registered with the SceneManager).
 *
 * Controls so far:
 *   R          - generate a new map with a new seed
 *   L          - open the AI Lab (temporary until the main menu exists in P7)
 *   mouse over - shows the tile type and cost under the cursor
 */

import { MAP } from '../config.js';
import { createRng } from '../core/rng.js';
import { generateMap } from '../world/mapGen.js';
import { inBounds, getTile } from '../world/grid.js';
import { TILE_INFO } from '../world/tiles.js';
import { drawMap, drawTileHighlight } from '../render/mapRenderer.js';
import { drawTextPanel } from '../render/hud.js';

export class GameScene {
  // app = shared objects created in main.js: { input, loopStats, seed, ... }
  constructor(app) {
    this.app = app;
    this.rng = null;
    this.map = null;
    this.hoveredTile = null;
  }

  // Only build the map the first time, so visiting the AI Lab and coming back
  // keeps the current map.
  enter() {
    if (this.map === null) {
      this.startNewMap(this.app.seed);
    }
  }

  exit() {}

  // Every new game creates ONE rng from the seed. Everything random in this game
  // draws from this single generator, so a seed fully determines what happens.
  startNewMap(seed) {
    this.rng = createRng(seed);
    this.map = generateMap(this.rng);
  }

  update() {
    const input = this.app.input;

    if (input.wasPressed('r')) {
      // The next seed comes from the current RNG (not Math.random), so even the
      // sequence of maps you get by pressing R is reproducible.
      const nextSeed = this.rng.int(1, 999999);
      this.startNewMap(nextSeed);
    }
    // Temporary way into the AI Lab until the main menu exists (P7).
    if (input.wasPressed('l')) {
      this.app.scenes.switchTo('lab');
      return;
    }

    this.hoveredTile = this.tileUnderMouse();
  }

  // Pixel -> tile: tileX = floor(pixelX / tileSize)
  tileUnderMouse() {
    const mouse = this.app.input.mouse;
    if (!mouse.insideCanvas) {
      return null;
    }
    const tileX = Math.floor(mouse.x / MAP.tileSize);
    const tileY = Math.floor(mouse.y / MAP.tileSize);
    if (!inBounds(this.map.grid, tileX, tileY)) {
      return null;
    }
    return { x: tileX, y: tileY };
  }

  render(ctx) {
    drawMap(ctx, this.map);

    if (this.hoveredTile !== null) {
      drawTileHighlight(ctx, this.hoveredTile.x, this.hoveredTile.y);
    }

    drawTextPanel(ctx, 8, 8, this.hudLines());
  }

  hudLines() {
    const lines = [
      'Seed: ' + this.rng.seed,
      'FPS: ' + this.app.loopStats.fps,
      'Map attempts: ' + this.map.attempts,
    ];
    if (this.hoveredTile !== null) {
      const info = TILE_INFO[getTile(this.map.grid, this.hoveredTile.x, this.hoveredTile.y)];
      const costText = info.walkable ? String(info.cost) : 'blocked';
      lines.push('Tile (' + this.hoveredTile.x + ', ' + this.hoveredTile.y + '): ' + info.name + ', cost ' + costText);
    }
    lines.push('R: new map   L: AI Lab');
    return lines;
  }
}
