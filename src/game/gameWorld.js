/*
 * gameWorld.js - the whole game simulation (no drawing, no input handling).
 * Course concept: the per-step pipeline of a game AI:
 *     waves -> spatial hash rebuild -> perception timers -> AI decisions (brains)
 *           -> path service (time-sliced) -> movement (kinematic or steering)
 *           -> local replanning + bridge bookkeeping -> combat -> deaths -> win/lose
 * Used by: scenes/gameScene.js (which adds input and rendering).
 *
 * Pure logic: no DOM or canvas, so the whole game can run headless in tests.
 */

import {
  AI, BASE, FORMATION, STEERING, WAVES, COMBAT, PLAYER_SPAWN_OFFSET_X,
  PERFORMANCE, RESERVATIONS, REPLAN, MAP,
} from '../config.js';
import { vec, distance } from '../core/vector.js';
import { createRng } from '../core/rng.js';
import { SpatialHash } from '../core/spatialHash.js';
import { generateMap } from '../world/mapGen.js';
import { tileCenterPixel, isWalkable, pixelToTile } from '../world/grid.js';
import { buildAbstractGraph } from '../pathfinding/hpa.js';
import { smoothPath, tilePathToPixels } from '../pathfinding/smoothing.js';
import { PathService } from '../pathfinding/pathService.js';
import { ReservationTable } from '../pathfinding/reservations.js';
import { formationOffsets, FORMATION_NAMES } from '../movement/formations.js';
import { moveUnit, pathOrder, idleOrder, followerFromTiles } from '../movement/unitMovement.js';
import { createEnemyBrain } from '../ai/enemyBrain.js';
import { createAllyBrain } from '../ai/allyBrain.js';
import { chooseEngagementAction } from '../ai/decision.js';
import { createUnit } from './units.js';
import { createBase } from './base.js';
import { createSquad, updateSquad } from './squads.js';
import { tryAttackUnit, tickCooldown, isInReach } from './combat.js';
import { WaveManager } from './waves.js';

export const ALLY_COUNT = 8;

export class GameWorld {
  // app supplies the live movementMode ('steering' | 'kinematic', K key).
  constructor(seed, app) {
    this.app = app;
    this.seed = seed;
    // ONE seeded RNG for everything random in this game.
    this.rng = createRng(seed);
    this.map = generateMap(this.rng);
    this.grid = this.map.grid;
    this.hpaGraph = buildAbstractGraph(this.grid);
    this.base = createBase();

    this.units = [];
    this.squads = [];
    this.nextUnitId = 1;
    this.nextSquadId = 1;
    this.time = 0;
    this.state = 'playing'; // 'playing' | 'won' | 'lost'

    this.formationName = 'LINE';
    this.guardMode = false;
    this.commanderRespawnTimer = 0;

    // HOW enemies decide. P7 swaps these for the predictable rules / difficulty.
    this.aiSettings = {
      reactionTime: AI.reactionTime,
      chooseAction: (rng) => chooseEngagementAction(rng, AI.decisionWeights),
      chooseFlankSide: (rng) => (rng.chance(0.5) ? 1 : -1),
    };

    // Performance helpers (P6).
    this.hash = new SpatialHash(PERFORMANCE.hashCellSize, this.grid.width * MAP.tileSize, this.grid.height * MAP.tileSize);
    const bridgeIds = this.map.bridges.map((bridge) => bridge.id);
    this.reservations = new ReservationTable(bridgeIds, RESERVATIONS.bridgeCapacity);
    this.paths = new PathService({
      grid: this.grid,
      hpaGraph: this.hpaGraph,
      bridges: this.map.bridges,
      riverLeft: this.map.riverLeft,
      reservations: this.reservations,
    });
    this.stats = { localReplans: 0, neighbourChecks: 0 };

    this.commander = this.spawnPlayerUnits();
    this.waves = new WaveManager();
  }

  get movementMode() {
    return this.app.movementMode;
  }

  // ---- Setup -----------------------------------------------------------------

  playerSpawnTile() {
    return { x: BASE.x + BASE.width + PLAYER_SPAWN_OFFSET_X, y: BASE.y + Math.floor(BASE.height / 2) };
  }

  addUnit(kind, position) {
    const unit = createUnit(this.nextUnitId, kind, position);
    this.nextUnitId += 1;
    this.units.push(unit);
    return unit;
  }

  spawnPlayerUnits() {
    const tile = this.playerSpawnTile();
    const position = vec(tileCenterPixel(tile.x), tileCenterPixel(tile.y));
    const commander = this.addUnit('commander', position);

    const offsets = formationOffsets(this.formationName, ALLY_COUNT, FORMATION.spacing);
    for (let i = 0; i < ALLY_COUNT; i++) {
      const ally = this.addUnit('ally', vec(position.x + offsets[i].x, position.y + offsets[i].y));
      ally.slotIndex = i;
      ally.brain = createAllyBrain(ally, this);
    }
    return commander;
  }

  // Called by the WaveManager. Squads appear on a random row at the right edge.
  spawnSquad(size) {
    const leaderTile = { x: this.grid.width - 4, y: this.rng.int(4, this.grid.height - 5) };
    const members = [];
    for (let i = 0; i < size; i++) {
      // Small block of tiles around the leader tile (the spawn edge is kept clear).
      const tile = { x: leaderTile.x + (i % 3) - 1, y: leaderTile.y + Math.floor(i / 3) - 1 };
      if (!isWalkable(this.grid, tile.x, tile.y)) {
        continue;
      }
      const enemy = this.addUnit('enemy', vec(tileCenterPixel(tile.x), tileCenterPixel(tile.y)));
      enemy.agent.heading = Math.PI; // facing left, towards the base
      enemy.spawnTile = leaderTile;
      members.push(enemy);
    }
    if (members.length === 0) {
      return;
    }
    const squad = createSquad(this.nextSquadId, members);
    this.nextSquadId += 1;
    this.squads.push(squad);
    for (const enemy of members) {
      enemy.brain = createEnemyBrain(enemy, this);
    }
  }

  // ---- Queries used by brains and movement ------------------------------------------

  enemyUnits() {
    return this.units.filter((unit) => unit.team === 'enemy' && unit.alive);
  }

  enemyCount() {
    return this.enemyUnits().length;
  }

  // AGENTS of the units close enough to matter for separation. The spatial hash
  // only looks at the cells around the unit instead of at every unit (O(n^2)).
  neighboursOf(unit) {
    const nearby = this.hash.queryRadius(unit.agent.position, STEERING.separationRadius);
    const agents = [];
    for (const other of nearby) {
      agents.push(other.agent);
    }
    return agents;
  }

  // Living units of the OTHER team within `radius` (candidates for sight checks).
  opponentsNear(unit, radius) {
    return this.hash.queryRadius(unit.agent.position, radius)
      .filter((other) => other.team !== unit.team && other.alive);
  }

  // Formation anchor for following allies: the Commander, or the guard point
  // while the Commander is dead.
  commanderAnchor() {
    if (!this.commander.alive) {
      return this.guardAnchor();
    }
    return { position: this.commander.agent.position, heading: this.commander.agent.heading };
  }

  // Guard formation faces the enemy side (heading 0 = facing right).
  guardAnchor() {
    return { position: this.base.guardPoint, heading: 0 };
  }

  allySlotOffset(ally) {
    return formationOffsets(this.formationName, ALLY_COUNT, FORMATION.spacing)[ally.slotIndex];
  }

  // ---- Path requests -----------------------------------------------------------
  // Brains ask for paths through these two functions and get the answer later in
  // a callback: the path service queues requests and answers a few per step
  // (time slicing, see pathfinding/pathService.js).

  requestPath(unit, goalTile, onReady, channel = 'path') {
    this.paths.requestPath(unit, goalTile, onReady, channel);
  }

  // options: { crossing: true, groupSize } plans the river crossing in time.
  requestRoute(unit, goalTile, onReady, options = {}) {
    this.paths.requestRoute(unit, goalTile, onReady, options);
  }

  // ---- Player commands -----------------------------------------------------------

  orderCommanderTo(goalTile) {
    const commander = this.commander;
    if (!commander.alive || !isWalkable(this.grid, goalTile.x, goalTile.y)) {
      return false;
    }
    this.requestPath(commander, goalTile, (tilePath) => {
      if (tilePath === null) {
        return;
      }
      const follower = followerFromTiles(this.grid, tilePath, commander.agent.radius);
      commander.order = pathOrder(follower);
      commander.rawPath = tilePath;
    });
    return true;
  }

  cycleFormation() {
    const index = FORMATION_NAMES.indexOf(this.formationName);
    this.formationName = FORMATION_NAMES[(index + 1) % FORMATION_NAMES.length];
  }

  toggleGuard() {
    this.guardMode = !this.guardMode;
  }

  // ---- One simulation step ---------------------------------------------------------

  update(dt) {
    if (this.state !== 'playing') {
      return;
    }
    this.time += dt;
    this.waves.update(dt, this);
    this.rebuildSpatialHash();
    this.updateThinkTimers(dt);

    // AI decisions
    for (const unit of this.units) {
      if (unit.alive && unit.brain !== null) {
        unit.brain.update(dt);
      }
    }
    this.updateCommander(dt);

    // Path service: answer a few queued requests (time slicing)
    this.paths.update(this.time);

    // Steering + physics
    for (const unit of this.units) {
      if (unit.alive) {
        moveUnit(unit, this, dt);
        tickCooldown(unit, dt);
      }
    }
    this.updateLocalReplanning(dt);
    this.updateBridgeCrossings();

    this.stats.neighbourChecks = this.hash.checksThisStep;
    this.handleDeaths();
    this.checkEndConditions();
  }

  rebuildSpatialHash() {
    this.hash.clear();
    for (const unit of this.units) {
      if (unit.alive) {
        this.hash.insert(unit, unit.agent.position);
      }
    }
  }

  // ---- Local replanning -------------------------------------------------------------
  // A unit that makes no progress towards its current waypoint for
  // REPLAN.noProgressSeconds (pushed behind a rock by the crowd, blocked by other
  // units...) replans ONLY the next 2 waypoints with a short A* and splices the
  // detour into its path. The rest of the path is kept: replanning the whole
  // path would cost much more and usually give the same result.
  updateLocalReplanning(dt) {
    for (const unit of this.units) {
      if (unit.replanFlashTimer > 0) {
        unit.replanFlashTimer -= dt;
      }
      const order = unit.order;
      const isFollowing = (order.type === 'path' || order.type === 'route') && !order.follower.finished;
      if (!unit.alive || !isFollowing || unit.isWaiting) {
        unit.progress = null;
        continue;
      }
      const follower = order.follower;
      const distanceToWaypoint = distance(unit.agent.position, follower.path[follower.index]);
      const progress = unit.progress;
      // New order or new waypoint: start measuring again.
      if (progress === null || progress.order !== order || progress.index !== follower.index) {
        unit.progress = { order: order, index: follower.index, best: distanceToWaypoint, stuckTime: 0 };
        continue;
      }
      if (distanceToWaypoint < progress.best - REPLAN.minProgress) {
        progress.best = distanceToWaypoint;
        progress.stuckTime = 0;
      } else {
        progress.stuckTime += dt;
      }
      if (progress.stuckTime >= REPLAN.noProgressSeconds && !unit.waitingForReplan) {
        progress.stuckTime = 0;
        this.replanLocally(unit, order);
      }
    }
  }

  replanLocally(unit, order) {
    const follower = order.follower;
    const firstIndex = follower.index;
    const lastIndex = Math.min(firstIndex + 1, follower.path.length - 1); // the next 2 waypoints
    const goalPoint = follower.path[lastIndex];
    const goalTile = { x: pixelToTile(goalPoint.x), y: pixelToTile(goalPoint.y) };
    unit.waitingForReplan = true;
    this.requestPath(unit, goalTile, (tilePath) => {
      unit.waitingForReplan = false;
      if (tilePath === null || !unit.alive || unit.order !== order) {
        return; // the plan changed in the meantime
      }
      const detour = tilePathToPixels(smoothPath(this.grid, tilePath, unit.agent.radius)).slice(1);
      if (detour.length === 0) {
        return; // already standing on the goal tile
      }
      // Keep the exact original goal point at the end of the detour.
      detour[detour.length - 1] = goalPoint;
      follower.path.splice(firstIndex, lastIndex - firstIndex + 1, ...detour);
      follower.index = firstIndex;
      this.stats.localReplans += 1;
      unit.replanFlashTimer = 1;
    }, 'replan');
  }

  // ---- Bridge reservations bookkeeping -----------------------------------------------
  // A reservation is released when the unit has crossed (near the far end), when
  // its plan changed (a different order), or when it died.
  updateBridgeCrossings() {
    for (const unit of this.units) {
      const order = unit.order;
      if (unit.alive && order.crossing && unit.activeCrossing === null) {
        unit.activeCrossing = { crossing: order.crossing, order: order };
      }
      const active = unit.activeCrossing;
      if (active === null) {
        continue;
      }
      const crossed = distance(unit.agent.position, active.crossing.exitPoint) < RESERVATIONS.releaseRadius;
      if (!unit.alive || unit.order !== active.order || crossed) {
        this.reservations.release(active.crossing.reservation);
        unit.activeCrossing = null;
      }
    }
    this.reservations.expire(this.time, RESERVATIONS.expireAfter);
  }

  // ---- Stress test -------------------------------------------------------------------
  // Spawns PERFORMANCE.stressTestEnemies extra enemies in squads at the right edge.
  spawnStressTest() {
    let remaining = PERFORMANCE.stressTestEnemies;
    while (remaining > 0) {
      const size = Math.min(WAVES.maxSquadSize, remaining);
      this.spawnSquad(size);
      remaining -= size;
    }
  }

  // Each unit thinks (runs its perception) once per AI.thinkInterval.
  updateThinkTimers(dt) {
    for (const unit of this.units) {
      unit.thinkTimer -= dt;
      unit.thinksThisStep = unit.thinkTimer <= 0;
      if (unit.thinksThisStep) {
        unit.thinkTimer += AI.thinkInterval;
      }
    }
  }

  // The Commander has no brain: the player moves him, and he automatically hits
  // the nearest enemy within reach. When dead he respawns at the base.
  updateCommander(dt) {
    const commander = this.commander;
    if (!commander.alive) {
      this.commanderRespawnTimer -= dt;
      if (this.commanderRespawnTimer <= 0) {
        this.respawnCommander();
      }
      return;
    }
    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of this.opponentsNear(commander, commander.sightRange)) {
      const d = distance(commander.agent.position, enemy.agent.position);
      if (d < nearestDistance && isInReach(commander, enemy.agent.position, enemy.agent.radius)) {
        nearest = enemy;
        nearestDistance = d;
      }
    }
    if (nearest !== null) {
      tryAttackUnit(commander, nearest);
    }
  }

  respawnCommander() {
    const commander = this.commander;
    const tile = this.playerSpawnTile();
    commander.agent.position = vec(tileCenterPixel(tile.x), tileCenterPixel(tile.y));
    commander.agent.velocity = vec(0, 0);
    commander.hp = commander.maxHp;
    commander.alive = true;
    commander.order = idleOrder();
    commander.rawPath = null;
  }

  handleDeaths() {
    for (const unit of this.units) {
      if (unit.alive && unit.hp <= 0) {
        unit.alive = false;
        if (unit === this.commander) {
          this.commanderRespawnTimer = COMBAT.commanderRespawnSeconds;
          unit.order = idleOrder();
        }
      }
    }
    // The Commander stays in the list (he respawns); every other dead unit is removed.
    this.units = this.units.filter((unit) => unit.alive || unit === this.commander);
    for (const squad of this.squads) {
      updateSquad(squad);
    }
    this.squads = this.squads.filter((squad) => squad.members.length > 0);
  }

  checkEndConditions() {
    if (this.base.hp <= 0) {
      this.state = 'lost';
    } else if (this.waves.isComplete()) {
      this.state = 'won';
    }
  }

  // HUD helper: "Wave 3/10 (fighting)".
  waveLabel() {
    return 'Wave ' + this.waves.waveNumber + '/' + WAVES.total + ' (' + this.waves.state + ')';
  }
}
