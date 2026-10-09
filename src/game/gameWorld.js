/*
 * gameWorld.js - the whole game simulation (no drawing, no input handling).
 * Course concept: the per-step pipeline of a game AI:
 *     waves -> perception timers -> AI decisions (brains) -> paths
 *           -> movement (kinematic or steering) -> combat -> deaths -> win/lose
 * Used by: scenes/gameScene.js (which adds input and rendering).
 *
 * Pure logic: no DOM or canvas, so the whole game can run headless in tests.
 */

import { AI, BASE, FORMATION, STEERING, WAVES, COMBAT, PLAYER_SPAWN_OFFSET_X } from '../config.js';
import { vec, distance } from '../core/vector.js';
import { createRng } from '../core/rng.js';
import { generateMap } from '../world/mapGen.js';
import { tileCenterPixel, isWalkable } from '../world/grid.js';
import { findPath } from '../pathfinding/astar.js';
import { buildAbstractGraph, hpaFindPath } from '../pathfinding/hpa.js';
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

    this.stats = { lastAstar: null, lastHpa: null };
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

  playerUnits() {
    return this.units.filter((unit) => unit.team === 'player' && unit.alive);
  }

  enemyUnits() {
    return this.units.filter((unit) => unit.team === 'enemy' && unit.alive);
  }

  enemyCount() {
    return this.enemyUnits().length;
  }

  // AGENTS of the units close enough to matter for separation. Brute force: every
  // unit checks every other unit, O(n^2). P6 replaces this with a spatial hash.
  neighboursOf(unit) {
    const result = [];
    for (const other of this.units) {
      if (other.alive && distance(unit.agent.position, other.agent.position) < STEERING.separationRadius) {
        result.push(other.agent);
      }
    }
    return result;
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
  // Brains ask for paths through these two functions and get the answer in a
  // callback. For now we answer immediately; in P6 a path service queues the
  // requests and answers a fixed number per frame (time slicing), without any
  // change to the brains.

  requestPath(unit, goalTile, onReady) {
    const result = findPath(this.grid, unit.agent.currentTile(), goalTile);
    this.stats.lastAstar = result;
    onReady(result.path);
  }

  requestRoute(unit, goalTile, onReady) {
    const route = hpaFindPath(this.hpaGraph, unit.agent.currentTile(), goalTile, { useCache: true });
    this.stats.lastHpa = route;
    onReady(route.found ? route : null);
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
    this.updateThinkTimers(dt);

    for (const unit of this.units) {
      if (unit.alive && unit.brain !== null) {
        unit.brain.update(dt);
      }
    }
    this.updateCommander(dt);

    for (const unit of this.units) {
      if (unit.alive) {
        moveUnit(unit, this, dt);
        tickCooldown(unit, dt);
      }
    }

    this.handleDeaths();
    this.checkEndConditions();
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
    for (const enemy of this.enemyUnits()) {
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
