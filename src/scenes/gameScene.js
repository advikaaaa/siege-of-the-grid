/*
 * gameScene.js - the main game screen: input + drawing around a GameWorld.
 * Course concept: this is where every technique is visible at once. All the
 * simulation lives in game/gameWorld.js; this file only turns keys, clicks and
 * buttons into commands and draws the world, the HUD and the debug overlays.
 * Used by: main.js.
 *
 * Controls:
 *   left click - send the Commander to that tile (A* + smoothing + path following)
 *   F          - cycle ally formation: LINE / V / BOX
 *   G          - allies guard the base / rejoin the Commander
 *   K          - switch kinematic / steering movement (all units)
 *   P          - switch enemy AI: uncertain (weighted dice) / predictable rules
 *   1 ... 7    - debug overlays (see render/overlays.js)
 *   T          - stress test: spawn 300 extra marching enemies (also a button)
 *   H          - help overlay with every key
 *   Esc        - pause menu
 */

import { MAP, RESERVATIONS, WAVES } from '../config.js';
import { GameWorld, ALLY_COUNT } from '../game/gameWorld.js';
import { DIFFICULTIES } from '../ai/difficulty.js';
import { inBounds, getTile } from '../world/grid.js';
import { TILE_INFO } from '../world/tiles.js';
import { drawMap, drawTileHighlight } from '../render/mapRenderer.js';
import { drawUnit, drawHealthBar, drawnRadius } from '../render/unitRenderer.js';
import { strokeCircle } from '../render/draw.js';
import {
  drawRawPath, drawFollowerPath, drawHpaOverlay, drawGoalMarker, drawStateLabels,
  drawBridgeTimeline, drawBridgeLabels, drawSpatialHash, drawAllSteering, drawSightRadii,
} from '../render/overlays.js';
import { drawTextPanel } from '../render/hud.js';

// Number key -> overlay name and description (also used by the help overlay).
const OVERLAYS = [
  { key: '1', name: 'paths', label: 'paths: raw A* (orange) vs followed waypoints (cyan)' },
  { key: '2', name: 'hpa', label: 'HPA*: clusters, entrances, abstract route' },
  { key: '3', name: 'steering', label: 'steering: velocity + each force, feelers' },
  { key: '4', name: 'states', label: 'FSM state above every NPC' },
  { key: '5', name: 'bridges', label: 'bridge reservation timeline, waiting units' },
  { key: '6', name: 'sight', label: 'sight radii' },
  { key: '7', name: 'hash', label: 'spatial hash cells' },
];

export class GameScene {
  constructor(app) {
    this.app = app;
    this.world = null;
    this.hoveredTile = null;
    this.paused = false;
    this.showHelp = false;
    this.overlays = {};
    for (const overlay of OVERLAYS) {
      this.overlays[overlay.name] = false;
    }

    this.toolbar = document.getElementById('game-toolbar');
    this.pausePanel = document.getElementById('pause-panel');
    document.getElementById('toolbar-stress').addEventListener('click', () => this.world.spawnStressTest());
    document.getElementById('toolbar-help').addEventListener('click', () => { this.showHelp = !this.showHelp; });
    document.getElementById('toolbar-pause').addEventListener('click', () => this.setPaused(true));
    document.getElementById('pause-resume').addEventListener('click', () => this.setPaused(false));
    document.getElementById('pause-restart').addEventListener('click', () => {
      this.startNewGame(this.world.seed);
      this.setPaused(false);
    });
    document.getElementById('pause-menu').addEventListener('click', () => this.app.scenes.switchTo('menu'));
  }

  // params.newGame: start a fresh game with app.seed. Otherwise (e.g. coming
  // back from the pause menu) the current game simply continues.
  enter(params) {
    if (params.newGame === true || this.world === null) {
      this.startNewGame(this.app.seed);
    }
    this.toolbar.hidden = false;
    this.setPaused(false);
  }

  exit() {
    this.toolbar.hidden = true;
    this.pausePanel.hidden = true;
  }

  startNewGame(seed) {
    this.app.seed = seed;
    this.world = new GameWorld(seed, this.app);
  }

  setPaused(paused) {
    this.paused = paused;
    this.pausePanel.hidden = !paused;
  }

  update(dt) {
    if (this.app.input.wasPressed('Escape')) {
      this.setPaused(!this.paused);
    }
    if (this.paused) {
      return;
    }
    this.handleKeys();
    this.handleClicks();
    this.world.update(dt);
    this.hoveredTile = this.tileUnderMouse();

    if (this.world.state !== 'playing') {
      this.app.scenes.switchTo('end', { won: this.world.state === 'won', summary: this.endSummary() });
    }
  }

  handleKeys() {
    const input = this.app.input;
    const world = this.world;
    if (input.wasPressed('k')) {
      this.app.movementMode = this.app.movementMode === 'steering' ? 'kinematic' : 'steering';
    }
    if (input.wasPressed('p')) {
      this.app.aiMode = this.app.aiMode === 'UNCERTAIN' ? 'PREDICTABLE' : 'UNCERTAIN';
      world.setAiOptions(this.app.difficulty, this.app.aiMode);
    }
    if (input.wasPressed('f')) {
      world.cycleFormation();
    }
    if (input.wasPressed('g')) {
      world.toggleGuard();
    }
    if (input.wasPressed('t')) {
      world.spawnStressTest();
    }
    if (input.wasPressed('h')) {
      this.showHelp = !this.showHelp;
    }
    for (const overlay of OVERLAYS) {
      if (input.wasPressed(overlay.key)) {
        this.overlays[overlay.name] = !this.overlays[overlay.name];
      }
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

  endSummary() {
    const world = this.world;
    const minutes = Math.floor(world.time / 60);
    const seconds = Math.floor(world.time % 60).toString().padStart(2, '0');
    const survived = world.state === 'won' ? WAVES.total : world.waves.waveNumber - 1;
    return 'Survived ' + survived + ' of ' + WAVES.total + ' waves in ' + minutes + ':' + seconds +
      '. Seed ' + world.seed + ', ' + DIFFICULTIES[this.app.difficulty].label + ', ' +
      this.app.aiMode.toLowerCase() + ' AI.';
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
    if (this.overlays.sight) {
      drawSightRadii(ctx, world.units);
    }
    drawHealthBar(ctx, { x: world.base.centre.x, y: world.base.rect.top }, 48, 14, world.base.hp / world.base.maxHp);

    if (this.overlays.paths) {
      this.drawPaths(ctx);
    }
    this.drawCommanderGoal(ctx);
    if (this.overlays.steering) {
      drawAllSteering(ctx, world.units, world.grid);
    }
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

    drawTextPanel(ctx, 8, 8, this.statsLines());
    drawTextPanel(ctx, ctx.canvas.width - 8, 8, this.statusLines(), 'right');
    if (this.showHelp) {
      drawTextPanel(ctx, ctx.canvas.width / 2 - 230, 190, this.helpLines());
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
        strokeCircle(ctx, unit.agent.position, drawnRadius(unit.agent) + 6, '#ff00ff');
      }
    }
  }

  // Overlay 5: units holding at a bridge entrance for their reserved slot.
  drawWaitingUnits(ctx) {
    for (const unit of this.world.units) {
      if (unit.alive && unit.isWaiting) {
        strokeCircle(ctx, unit.agent.position, drawnRadius(unit.agent) + 5, '#ffd84d');
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

  // ---- HUD text ------------------------------------------------------------------

  // Left panel: the AI / performance statistics.
  statsLines() {
    const world = this.world;
    const pathStats = world.paths.stats;
    const unitCount = world.units.filter((unit) => unit.alive).length;
    const lines = [
      'FPS: ' + this.app.loopStats.fps + '   Seed: ' + world.seed,
      'Difficulty: ' + DIFFICULTIES[this.app.difficulty].label + '   AI: ' + this.app.aiMode + ' (P)' +
        '   Movement: ' + this.app.movementMode.toUpperCase() + ' (K)',
      // Brute force would compare every unit with every other one: n * n checks.
      'Units: ' + unitCount + '   Neighbour checks: ' + world.stats.neighbourChecks +
        ' (brute force: ' + unitCount * unitCount + ')',
      'Path requests this step: ' + pathStats.processedThisStep + '   queued: ' + world.paths.queuedCount() +
        '   cache hits: ' + pathStats.cacheHits + '   local replans: ' + world.stats.localReplans,
    ];
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
    return lines;
  }

  // Right panel: the state of the game.
  statusLines() {
    const world = this.world;
    const commander = world.commander;
    const commanderText = commander.alive
      ? 'Commander HP: ' + Math.ceil(commander.hp) + '/' + commander.maxHp
      : 'Commander respawns in ' + world.commanderRespawnTimer.toFixed(1) + ' s';
    return [
      world.waveLabel(),
      'Enemies: ' + world.enemyCount(),
      'Base HP: ' + Math.ceil(world.base.hp) + '/' + world.base.maxHp,
      commanderText,
      'Allies: ' + world.allyCount() + '/' + ALLY_COUNT,
      'Formation: ' + world.formationName + ' (F)',
      world.guardMode ? 'Allies: GUARDING base (G)' : 'Allies: following (G)',
      'H: help   Esc: pause',
    ];
  }

  helpLines() {
    const lines = [
      'CONTROLS (H to close)',
      '',
      'Left click   move the Commander (A* + smoothing)',
      'F            ally formation: LINE / V / BOX',
      'G            allies guard the base / rejoin',
      'K            kinematic / steering movement',
      'P            enemy AI: uncertain / predictable rules',
      'T            stress test: +300 enemies',
      'Esc          pause menu',
      '',
      'OVERLAYS',
    ];
    for (const overlay of OVERLAYS) {
      const state = this.overlays[overlay.name] ? 'ON ' : 'off';
      lines.push(overlay.key + '  [' + state + ']  ' + overlay.label);
    }
    return lines;
  }
}
