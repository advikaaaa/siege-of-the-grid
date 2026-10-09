/*
 * gameScene.js - the main game screen.
 * Course concept: this is where everything comes together. So far it owns the
 * seeded RNG, the map and the Commander, who moves by A* + path smoothing + path
 * following. Units, AI and more overlays are added in later phases.
 * Used by: main.js (registered with the SceneManager).
 *
 * Controls so far:
 *   left click - send the Commander to that tile
 *   K          - switch kinematic / steering movement
 *   1          - overlay: raw A* path (orange) vs smoothed path (cyan)
 *   R          - generate a new map with a new seed
 *   L          - open the AI Lab (temporary until the main menu exists in P7)
 *   mouse over - shows the tile type and cost under the cursor
 */

import { MAP, BASE } from '../config.js';
import { vec } from '../core/vector.js';
import { createRng } from '../core/rng.js';
import { generateMap } from '../world/mapGen.js';
import { inBounds, getTile, isWalkable, tileCenterPixel } from '../world/grid.js';
import { TILE_INFO } from '../world/tiles.js';
import { findPath } from '../pathfinding/astar.js';
import { smoothPath, tilePathToPixels } from '../pathfinding/smoothing.js';
import { createFollower, moveAlongPath } from '../movement/pathMovement.js';
import { createCommander } from '../game/units.js';
import { drawMap, drawTileHighlight } from '../render/mapRenderer.js';
import { drawAgent } from '../render/unitRenderer.js';
import { drawPathOverlay, drawGoalMarker } from '../render/overlays.js';
import { drawTextPanel } from '../render/hud.js';

export class GameScene {
  // app = shared objects created in main.js: { input, loopStats, seed, movementMode, ... }
  constructor(app) {
    this.app = app;
    this.rng = null;
    this.map = null;
    this.commander = null;
    this.hoveredTile = null;
    this.lastSearch = null;   // stats of the last A* query, shown in the HUD
    this.message = '';
    this.overlays = { paths: false };
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
    this.lastSearch = null;
    this.message = '';

    // The Commander starts just to the right of the base.
    const startTileX = BASE.x + BASE.width + 1;
    const startTileY = BASE.y + Math.floor(BASE.height / 2);
    this.commander = createCommander(vec(tileCenterPixel(startTileX), tileCenterPixel(startTileY)));
  }

  update(dt) {
    this.handleKeys();
    if (this.app.scenes.currentScene !== this) {
      return; // a key switched to another scene
    }
    this.handleClicks();

    const commander = this.commander;
    moveAlongPath(commander.agent, commander.follower, this.map.grid, [commander.agent], this.app.movementMode, dt);

    this.hoveredTile = this.tileUnderMouse();
  }

  handleKeys() {
    const input = this.app.input;
    if (input.wasPressed('r')) {
      // The next seed comes from the current RNG (not Math.random), so even the
      // sequence of maps you get by pressing R is reproducible.
      const nextSeed = this.rng.int(1, 999999);
      this.startNewMap(nextSeed);
    }
    if (input.wasPressed('k')) {
      this.app.movementMode = this.app.movementMode === 'steering' ? 'kinematic' : 'steering';
    }
    if (input.wasPressed('1')) {
      this.overlays.paths = !this.overlays.paths;
    }
    // Temporary way into the AI Lab until the main menu exists (P7).
    if (input.wasPressed('l')) {
      this.app.scenes.switchTo('lab');
    }
  }

  handleClicks() {
    for (const click of this.app.input.clicks) {
      if (click.button !== 0) {
        continue; // only the left button moves the Commander
      }
      const tile = { x: Math.floor(click.x / MAP.tileSize), y: Math.floor(click.y / MAP.tileSize) };
      this.orderCommanderTo(tile);
    }
  }

  // Click-to-move: A* from the Commander's tile to the clicked tile, smooth the
  // result, and hand it to the path follower.
  orderCommanderTo(goalTile) {
    const grid = this.map.grid;
    if (!isWalkable(grid, goalTile.x, goalTile.y)) {
      this.message = 'Cannot walk there: tile is blocked';
      return;
    }
    const commander = this.commander;
    const search = findPath(grid, commander.agent.currentTile(), goalTile);
    if (search.path === null) {
      this.message = 'No path found';
      return;
    }

    const smoothed = smoothPath(grid, search.path, commander.agent.radius);
    commander.rawPath = search.path;
    commander.smoothedPath = smoothed;
    commander.follower = createFollower(tilePathToPixels(smoothed));

    this.lastSearch = {
      nodesExpanded: search.nodesExpanded,
      timeMs: search.timeMs,
      cost: search.cost,
      rawWaypoints: search.path.length,
      smoothedWaypoints: smoothed.length,
    };
    this.message = '';
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

    const commander = this.commander;
    const isMoving = commander.follower !== null && !commander.follower.finished;
    if (this.overlays.paths && commander.rawPath !== null && isMoving) {
      drawPathOverlay(ctx, commander.rawPath, commander.smoothedPath);
    }
    if (isMoving) {
      const path = commander.follower.path;
      drawGoalMarker(ctx, path[path.length - 1], '#ffffff');
    }
    drawAgent(ctx, commander.agent, commander.color);

    if (this.hoveredTile !== null) {
      drawTileHighlight(ctx, this.hoveredTile.x, this.hoveredTile.y);
    }

    drawTextPanel(ctx, 8, 8, this.hudLines());
  }

  hudLines() {
    const lines = [
      'Seed: ' + this.rng.seed + '   FPS: ' + this.app.loopStats.fps,
      'Map attempts: ' + this.map.attempts,
      'Movement: ' + this.app.movementMode.toUpperCase() + ' (K)',
    ];
    if (this.lastSearch !== null) {
      const s = this.lastSearch;
      lines.push('Last A*: ' + s.nodesExpanded + ' nodes, ' + s.timeMs.toFixed(2) + ' ms, cost ' + s.cost.toFixed(1));
      lines.push('Waypoints: ' + s.rawWaypoints + ' raw -> ' + s.smoothedWaypoints + ' smoothed');
    }
    if (this.hoveredTile !== null) {
      const info = TILE_INFO[getTile(this.map.grid, this.hoveredTile.x, this.hoveredTile.y)];
      const costText = info.walkable ? String(info.cost) : 'blocked';
      lines.push('Tile (' + this.hoveredTile.x + ', ' + this.hoveredTile.y + '): ' + info.name + ', cost ' + costText);
    }
    if (this.message !== '') {
      lines.push('! ' + this.message);
    }
    lines.push('Click: move   1: paths ' + (this.overlays.paths ? 'ON' : 'off') + '   R: new map   L: AI Lab');
    return lines;
  }
}
