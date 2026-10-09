/*
 * pathService.js - a queue of path requests, answered a few per step, with a cache.
 * Course concept: PERFORMANCE FOR MANY NPCs.
 *   - TIME SLICING: when 50 squads want paths in the same frame, searching them
 *     all at once would freeze the game. Requests wait in a queue and only
 *     `pathRequestsPerStep` are answered per step; the rest next step. A unit
 *     waits a few frames for its path, which nobody notices.
 *   - CACHING: identical A* queries (same start tile, same goal tile) are answered
 *     from a cache (least-recently-used entries are dropped when it is full).
 *     HPA* routes are shared through hpa.js's own cluster-pair route cache.
 *   - Only ONE pending request per unit and purpose: a newer request replaces
 *     the older one (the old callback receives null).
 *   - The Commander's requests jump the queue: the player must never wait.
 * It also does the time-aware BRIDGE planning for routes that cross the river
 * (see reservations.js).
 * Used by: game/gameWorld.js, tests/reservations.test.js, tests/spatialHash.test.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { MAP, MAPGEN, PERFORMANCE, RESERVATIONS, FORMATION } from '../config.js';
import { vec } from '../core/vector.js';
import { tileCenterPixel } from '../world/grid.js';
import { findPath } from './astar.js';
import { hpaFindPath } from './hpa.js';
import { chooseCrossing } from './reservations.js';

export class PathService {
  // deps = { grid, hpaGraph, bridges, riverLeft, reservations }
  constructor(deps) {
    this.grid = deps.grid;
    this.hpaGraph = deps.hpaGraph;
    this.bridges = deps.bridges;
    this.riverLeft = deps.riverLeft;
    this.reservations = deps.reservations;

    this.queue = [];
    this.pendingByKey = new Map(); // "unitId:channel" -> request
    this.cache = new Map();        // "sx,sy>gx,gy" -> tile path (Map keeps insertion order)
    this.stats = {
      processedThisStep: 0,
      cacheHits: 0,
      totalProcessed: 0,
      lastAstar: null,
      lastHpa: null,
      lastCrossing: null,
    };
  }

  queuedCount() {
    return this.pendingByKey.size;
  }

  // channel separates different purposes of the same unit (e.g. 'path' for
  // catching up and 'replan' for local replanning) so they do not cancel each other.
  requestPath(unit, goalTile, onReady, channel = 'path') {
    this.enqueue({ kind: 'path', channel: channel, unit: unit, goalTile: goalTile, onReady: onReady, options: {} });
  }

  // options.crossing: plan the river crossing in time (bridge reservations).
  // options.groupSize: how many units cross together (a squad).
  requestRoute(unit, goalTile, onReady, options = {}) {
    this.enqueue({ kind: 'route', channel: 'route', unit: unit, goalTile: goalTile, onReady: onReady, options: options });
  }

  enqueue(request) {
    const key = request.unit.id + ':' + request.channel;
    const older = this.pendingByKey.get(key);
    if (older !== undefined) {
      older.cancelled = true;
      older.onReady(null);
    }
    request.cancelled = false;
    this.pendingByKey.set(key, request);
    if (request.unit.kind === 'commander') {
      this.queue.unshift(request); // the player's orders go first
    } else {
      this.queue.push(request);
    }
  }

  // Called once per simulation step with the current game time.
  update(now) {
    this.stats.processedThisStep = 0;
    while (this.stats.processedThisStep < PERFORMANCE.pathRequestsPerStep && this.queue.length > 0) {
      const request = this.queue.shift();
      if (request.cancelled) {
        continue; // replaced by a newer request; does not use the budget
      }
      this.pendingByKey.delete(request.unit.id + ':' + request.channel);
      if (!request.unit.alive) {
        request.onReady(null);
        continue;
      }
      this.stats.processedThisStep += 1;
      this.stats.totalProcessed += 1;
      if (request.kind === 'path') {
        request.onReady(this.findTilePath(request.unit.agent.currentTile(), request.goalTile));
      } else {
        request.onReady(this.findRoute(request, now));
      }
    }
  }

  // ---- A* with an LRU cache ---------------------------------------------------------

  findTilePath(start, goal) {
    const key = start.x + ',' + start.y + '>' + goal.x + ',' + goal.y;
    if (this.cache.has(key)) {
      // Re-insert so this entry becomes the most recently used.
      const cached = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.stats.cacheHits += 1;
      return cached;
    }
    const result = findPath(this.grid, start, goal);
    this.stats.lastAstar = result;
    this.cache.set(key, result.path);
    if (this.cache.size > PERFORMANCE.pathCacheSize) {
      // The first key in a Map is the oldest = least recently used.
      this.cache.delete(this.cache.keys().next().value);
    }
    return result.path;
  }

  // ---- HPA* routes, with time-aware bridge planning --------------------------------

  findRoute(request, now) {
    const start = request.unit.agent.currentTile();
    const goal = request.goalTile;
    const crosses = this.sideOfRiver(start) !== this.sideOfRiver(goal) &&
      this.sideOfRiver(start) !== 'river' && this.sideOfRiver(goal) !== 'river';
    if (request.options.crossing === true && crosses) {
      return this.planCrossingRoute(request, start, goal, now);
    }
    const route = hpaFindPath(this.hpaGraph, start, goal, { useCache: true });
    this.stats.lastHpa = route;
    return route.found ? route : null;
  }

  // 'west', 'east' or 'river' (on the water or a bridge), using the river's
  // left column on that row (remembered by mapGen.js).
  sideOfRiver(tile) {
    const left = this.riverLeft[tile.y];
    if (tile.x < left) {
      return 'west';
    }
    if (tile.x >= left + MAPGEN.riverWidth) {
      return 'east';
    }
    return 'river';
  }

  // For each bridge: route to its near end, across, and on to the goal. Estimate
  // the arrival time and the expected wait, pick the cheapest total, reserve it.
  planCrossingRoute(request, start, goal, now) {
    const unit = request.unit;
    const groupSize = request.options.groupSize ?? 1;
    const secondsPerTile = MAP.tileSize / unit.agent.maxSpeed;
    const goingWest = this.sideOfRiver(start) === 'east';
    const options = [];

    for (const bridge of this.bridges) {
      const eastEnd = { x: bridge.right + 1, y: bridge.top };
      const westEnd = { x: bridge.left - 1, y: bridge.top };
      const entry = goingWest ? eastEnd : westEnd;
      const exit = goingWest ? westEnd : eastEnd;
      const toBridge = hpaFindPath(this.hpaGraph, start, entry, { useCache: true });
      const fromBridge = hpaFindPath(this.hpaGraph, exit, goal, { useCache: true });
      if (!toBridge.found || !fromBridge.found) {
        continue;
      }
      const crossingTiles = straightRow(entry, exit);
      // A squad crosses in single file: the last member enters (size-1)*spacing later.
      const crossingSeconds = (crossingTiles.length - 1) * secondsPerTile +
        ((groupSize - 1) * FORMATION.spacing) / unit.agent.maxSpeed + 2 * RESERVATIONS.safetyMargin;
      // ETA = path cost (in tiles) * seconds per tile, started a margin early.
      const desiredStart = now + toBridge.cost * secondsPerTile - RESERVATIONS.safetyMargin;
      const wait = this.reservations.expectedWait(bridge.id, desiredStart, crossingSeconds, groupSize);
      const travelTime = (toBridge.cost + crossingTiles.length - 1 + fromBridge.cost) * secondsPerTile;
      options.push({
        bridgeId: bridge.id, travelTime: travelTime, wait: wait, desiredStart: desiredStart,
        crossingSeconds: crossingSeconds, toBridge: toBridge, fromBridge: fromBridge,
        entry: entry, exit: exit, crossingTiles: crossingTiles,
      });
    }

    const choice = chooseCrossing(options);
    const chosen = choice.chosen;
    if (chosen === null) {
      return null;
    }
    const startTime = chosen.desiredStart + chosen.wait;
    const reservation = this.reservations.reserve(chosen.bridgeId, unit.id, startTime, startTime + chosen.crossingSeconds, groupSize);

    const route = combineRoutes(chosen.toBridge, chosen.crossingTiles, chosen.fromBridge);
    route.crossing = {
      reservation: reservation,
      holdPoint: vec(tileCenterPixel(chosen.entry.x), tileCenterPixel(chosen.entry.y)),
      holdUntil: startTime + RESERVATIONS.safetyMargin, // the planned moment to step on
      exitPoint: vec(tileCenterPixel(chosen.exit.x), tileCenterPixel(chosen.exit.y)),
    };
    this.stats.lastHpa = route;
    this.stats.lastCrossing = describeChoice(unit, choice, groupSize);
    return route;
  }
}

// Tiles along one row from `from` to `to` (inclusive), one step at a time.
function straightRow(from, to) {
  const tiles = [];
  const step = Math.sign(to.x - from.x);
  for (let x = from.x; x !== to.x + step; x += step) {
    tiles.push({ x: x, y: from.y });
  }
  return tiles;
}

// One route = route to the bridge + the crossing + route after the bridge.
// Segments stay separate, so lazy refinement still works segment by segment.
function combineRoutes(first, crossingTiles, second) {
  return {
    found: true,
    abstractTiles: first.abstractTiles.concat(second.abstractTiles),
    segments: first.segments.concat([{ tiles: crossingTiles }], second.segments),
    nextSegment: 0,
    cost: first.cost + (crossingTiles.length - 1) + second.cost,
    stats: {
      abstractNodesExpanded: first.stats.abstractNodesExpanded + second.stats.abstractNodesExpanded,
      insertionNodesExpanded: first.stats.insertionNodesExpanded + second.stats.insertionNodesExpanded,
      refinedTileNodes: 0,
      timeMs: first.stats.timeMs + second.stats.timeMs,
      fromCache: first.stats.fromCache && second.stats.fromCache,
    },
  };
}

// A one-line explanation for the HUD, e.g.
// "Unit 41 (x6): B2 busy, wait 3.4s (total 38.1s) -> B1 detour (total 35.9s)"
function describeChoice(unit, choice, groupSize) {
  const label = (option) => 'B' + (option.bridgeId + 1);
  const total = (option) => (option.travelTime + option.wait).toFixed(1) + 's';
  const chosen = choice.chosen;
  const preferred = choice.preferred;
  let text = 'Unit ' + unit.id + ' (x' + groupSize + '): ';
  if (chosen === preferred) {
    text += label(chosen) + (chosen.wait > 0 ? ', waits ' + chosen.wait.toFixed(1) + 's' : ', no wait') +
      ' (total ' + total(chosen) + ')';
  } else {
    text += label(preferred) + ' busy, wait ' + preferred.wait.toFixed(1) + 's (total ' + total(preferred) +
      ') -> ' + label(chosen) + ' detour (total ' + total(chosen) + ')';
  }
  return { text: text, chosenBridge: chosen.bridgeId, wait: chosen.wait };
}
