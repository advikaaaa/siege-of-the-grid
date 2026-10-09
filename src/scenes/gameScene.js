/*
 * gameScene.js - the main game screen: input + drawing around a GameWorld.
 * Course concept: this is where every technique is visible at once. All the
 * simulation lives in game/gameWorld.js; this file only turns keys and clicks
 * into commands and draws the world plus the debug overlays.
 * Used by: main.js (registered with the SceneManager).
 *
 * Controls so far:
 *   left click - send the Commander to that tile (A* + smoothing + path following)
 *   F          - cycle ally formation: LINE / V / BOX
 *   G          - allies guard the base / rejoin the Commander
 *   K          - switch kinematic / steering movement (all units)
 *   1          - overlay: paths (raw A* orange, followed waypoints cyan)
 *   2          - overlay: HPA* clusters, entrances and last abstract route
 *   4          - overlay: FSM state above every NPC
 *   5          - overlay: bridge reservation timeline (+ waiting units ringed)
 *   7          - overlay: spatial hash cells
 *   T          - stress test: spawn 300 extra marching enemies
 *   R          - new map with a new seed (restarts the game)
 *   L          - open the AI Lab (temporary until the main menu exists in P7)
 */

import { MAP, RESERVATIONS } from '../config.js';
import { GameWorld } from '../game/gameWorld.js';
import { inBounds, getTile } from '../world/grid.js';
import { TILE_INFO } from '../world/tiles.js';
import { drawMap, drawTileHighlight } from '../render/mapRenderer.js';
import { drawUnit, drawHealthBar } from '../render/unitRenderer.js';
import { strokeCircle } from '../render/draw.js';
import {
  drawRawPath, drawFollowerPath, drawHpaOverlay, drawGoalMarker, drawStateLabels,
  drawBridgeTimeline, drawBridgeLabels, drawSpatialHash,
} from '../render/overlays.js';
import { drawTextPanel } from '../render/hud.js';

export class GameScene {
  constructor(app) {
    this.app = app;
    this.world = null;
    this.hoveredTile = null;
    this.overlays = { paths: false, hpa: false, states: false, bridges: false, hash: false };
  }

  // Only build the world the first time, so visiting the AI Lab and coming back
  // continues the same game.
  enter() {
    if (this.world === null) {
      this.startNewGame(this.app.seed);
    }
  }

  exit() {}

  startNewGame(seed) {
    this.app.seed = seed; // the HUD and the AI Lab always use the current map's seed
    this.world = new GameWorld(seed, this.app);
  }

  update(dt) {
    this.handleKeys();
    if (this.app.scenes.currentScene !== this) {
      return; // a key switched to another scene
    }
    this.handleClicks();
    this.world.update(dt);
    this.hoveredTile = this.tileUnderMouse();
  }

  handleKeys() {
    const input = this.app.input;
    const world = this.world;
    if (input.wasPressed('r')) {
      // The next seed comes from the current RNG (not Math.random), so even the
      // sequence of maps you get by pressing R is reproducible.
      this.startNewGame(world.rng.int(1, 999999));
      return;
    }
    if (input.wasPressed('k')) {
      this.app.movementMode = this.app.movementMode === 'steering' ? 'kinematic' : 'steering';
    }
    if (input.wasPressed('f')) {
      world.cycleFormation();
    }
    if (input.wasPressed('g')) {
      world.toggleGuard();
    }
    if (input.wasPressed('1')) {
      this.overlays.paths = !this.overlays.paths;
    }
    if (input.wasPressed('2')) {
      this.overlays.hpa = !this.overlays.hpa;
    }
    if (input.wasPressed('4')) {
      this.overlays.states = !this.overlays.states;
    }
    if (input.wasPressed('5')) {
      this.overlays.bridges = !this.overlays.bridges;
    }
    if (input.wasPressed('7')) {
      this.overlays.hash = !this.overlays.hash;
    }
    if (input.wasPressed('t')) {
      world.spawnStressTest();
    }
    // Temporary way into the AI Lab until the main menu exists (P7).
    if (input.wasPressed('l')) {
      this.app.scenes.switchTo('lab');
    }
  }

  handleClicks() {
    for (const click of this.app.input.clicks) {
      if (click.button === 0) {
        const tile = { x: Math.floor(click.x / MAP.tileSize), y: Math.floor(click.y / MAP.tileSize) };
        this.world.orderCommanderTo(tile);
      }
    }
  }

  // Pixel -> tile: tileX = floor(pixelX / tileSize)
  tileUnderMouse() {
    const mouse = this.app.input.mouse;
    if (!mouse.insideCanvas) {
      return null;
    }
    const tile = { x: Math.floor(mouse.x / MAP.tileSize), y: Math.floor(mouse.y / MAP.tileSize) };
    return inBounds(this.world.grid, tile.x, tile.y) ? tile : null;
  }

  // ---- Drawing -------------------------------------------------------------------

  render(ctx) {
    const world = this.world;
    drawMap(ctx, world.map);
    if (this.overlays.hpa) {
      const lastRoute = world.paths.stats.lastHpa;
      drawHpaOverlay(ctx, world.hpaGraph, lastRoute !== null ? lastRoute.abstractTiles : null);
    }
    if (this.overlays.hash) {
      drawSpatialHash(ctx, world.hash);
    }
    drawHealthBar(ctx, { x: world.base.centre.x, y: world.base.rect.top }, 48, 14, world.base.hp / world.base.maxHp);

    if (this.overlays.paths) {
      this.drawPaths(ctx);
    }
    this.drawCommanderGoal(ctx);
    for (const unit of world.units) {
      drawUnit(ctx, unit);
    }
    if (this.overlays.states) {
      drawStateLabels(ctx, world.units);
    }
    if (this.overlays.bridges) {
      this.drawWaitingUnits(ctx);
      drawBridgeLabels(ctx, world.map.bridges);
      drawBridgeTimeline(ctx, world.reservations, world.map.bridges, world.time, RESERVATIONS.bridgeCapacity);
    }
    if (this.hoveredTile !== null) {
      drawTileHighlight(ctx, this.hoveredTile.x, this.hoveredTile.y);
    }

    drawTextPanel(ctx, 8, 8, this.hudLines());
    if (world.state !== 'playing') {
      this.drawEndBanner(ctx);
    }
  }

  // Overlay 1: the Commander's raw A* path, plus every unit's followed waypoints.
  drawPaths(ctx) {
    const commander = this.world.commander;
    if (commander.alive && commander.rawPath !== null && commander.order.type === 'path') {
      drawRawPath(ctx, commander.rawPath);
    }
    for (const unit of this.world.units) {
      const order = unit.order;
      const hasPath = order.type === 'path' || order.type === 'route';
      if (unit.alive && hasPath && !order.follower.finished) {
        drawFollowerPath(ctx, order.follower, unit.agent.position);
      }
      // A magenta ring for one second after a LOCAL REPLAN.
      if (unit.alive && unit.replanFlashTimer > 0) {
        strokeCircle(ctx, unit.agent.position, unit.agent.radius + 6, '#ff00ff');
      }
    }
  }

  // Overlay 5: units holding at a bridge entrance for their reserved slot.
  drawWaitingUnits(ctx) {
    for (const unit of this.world.units) {
      if (unit.alive && unit.isWaiting) {
        strokeCircle(ctx, unit.agent.position, unit.agent.radius + 5, '#ffd84d');
      }
    }
  }

  drawCommanderGoal(ctx) {
    const order = this.world.commander.order;
    if (order.type === 'path' && !order.follower.finished) {
      const path = order.follower.path;
      drawGoalMarker(ctx, path[path.length - 1], '#ffffff');
    }
  }

  drawEndBanner(ctx) {
    const won = this.world.state === 'won';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, ctx.canvas.height / 2 - 40, ctx.canvas.width, 80);
    ctx.fillStyle = won ? '#4caf50' : '#f44336';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(won ? 'VICTORY - all 10 waves survived' : 'DEFEAT - the base has fallen', ctx.canvas.width / 2, ctx.canvas.height / 2 + 4);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Press R for a new game', ctx.canvas.width / 2, ctx.canvas.height / 2 + 28);
    ctx.textAlign = 'left';
  }

  hudLines() {
    const world = this.world;
    const commander = world.commander;
    const commanderText = commander.alive
      ? 'Commander HP: ' + Math.ceil(commander.hp) + '/' + commander.maxHp
      : 'Commander respawns in ' + world.commanderRespawnTimer.toFixed(1) + ' s';
    const lines = [
      'Seed: ' + world.seed + '   FPS: ' + this.app.loopStats.fps,
      world.waveLabel() + '   Enemies: ' + world.enemyCount(),
      'Base HP: ' + Math.ceil(world.base.hp) + '/' + world.base.maxHp + '   ' + commanderText,
      'Movement: ' + this.app.movementMode.toUpperCase() + ' (K)   Formation: ' + world.formationName +
        ' (F)   ' + (world.guardMode ? 'GUARDING base (G)' : 'Following (G to guard)'),
    ];
    const pathStats = world.paths.stats;
    const unitCount = world.units.filter((unit) => unit.alive).length;
    // Brute force would compare every unit with every other one: n * n checks.
    lines.push('Units: ' + unitCount + '   Neighbour checks: ' + world.stats.neighbourChecks +
      ' (brute force: ' + unitCount * unitCount + ')');
    lines.push('Path requests this step: ' + pathStats.processedThisStep + '   queued: ' + world.paths.queuedCount() +
      '   cache hits: ' + pathStats.cacheHits + '   local replans: ' + world.stats.localReplans);
    const astar = pathStats.lastAstar;
    if (astar !== null) {
      lines.push('Last A*: ' + astar.nodesExpanded + ' nodes, ' + astar.timeMs.toFixed(2) + ' ms');
    }
    const hpa = pathStats.lastHpa;
    if (hpa !== null) {
      const s = hpa.stats;
      lines.push('Last HPA*: ' + s.abstractNodesExpanded + ' abstract + ' + s.insertionNodesExpanded +
        ' insertion nodes, ' + s.timeMs.toFixed(2) + ' ms' + (s.fromCache ? ' (cached route)' : ''));
    }
    if (pathStats.lastCrossing !== null) {
      lines.push('Bridge plan: ' + pathStats.lastCrossing.text);
    }
    if (this.hoveredTile !== null) {
      const info = TILE_INFO[getTile(world.grid, this.hoveredTile.x, this.hoveredTile.y)];
      const costText = info.walkable ? String(info.cost) : 'blocked';
      lines.push('Tile (' + this.hoveredTile.x + ', ' + this.hoveredTile.y + '): ' + info.name + ', cost ' + costText);
    }
    lines.push('Overlays: 1 paths ' + onOff(this.overlays.paths) + '  2 HPA* ' + onOff(this.overlays.hpa) +
      '  4 FSM ' + onOff(this.overlays.states) + '  5 bridges ' + onOff(this.overlays.bridges) +
      '  7 hash ' + onOff(this.overlays.hash));
    lines.push('T: stress test (+300 enemies)   R: new game   L: AI Lab');
    return lines;
  }
}

function onOff(flag) {
  return flag ? 'ON' : 'off';
}
