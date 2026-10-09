/*
 * pathCompare.js - AI Lab view 2: click two points, see A* and HPA* side by side.
 * Course concept: hierarchical vs flat pathfinding on the same query. The HPA*
 * clusters, entrances and abstract path are drawn too (same as overlay 2).
 * Used by: scenes/aiLabScene.js (the "A* vs HPA*" tab).
 *
 * Click 1 = start, click 2 = goal (runs both searches), click 3 = new start...
 */

import { MAP } from '../../config.js';
import { isWalkable } from '../../world/grid.js';
import { findPath } from '../../pathfinding/astar.js';
import { hpaFindPath, refineFullPath } from '../../pathfinding/hpa.js';
import { tileToPixel } from '../../pathfinding/smoothing.js';
import { drawMap } from '../../render/mapRenderer.js';
import { drawTextPanel } from '../../render/hud.js';
import { fillCircle } from '../../render/draw.js';
import { drawHpaOverlay, drawTilePath, ASTAR_COLOR, HPA_COLOR } from '../../render/overlays.js';

export class PathCompareView {
  // getSeedWorld() returns { map, graph } for the current seed (built by aiLabScene).
  constructor(app, getSeedWorld) {
    this.app = app;
    this.getSeedWorld = getSeedWorld;
    this.world = null;
    this.panel = document.getElementById('lab-compare');
    this.statsElement = document.getElementById('compare-stats');
    this.start = null;
    this.goal = null;
    this.result = null;
  }

  enter() {
    const world = this.getSeedWorld();
    if (world !== this.world) {
      // New seed since last time: old clicks would point at a different map.
      this.world = world;
      this.start = null;
      this.goal = null;
      this.result = null;
    }
    this.panel.hidden = false;
    this.showStats();
  }

  exit() {
    this.panel.hidden = true;
  }

  update() {
    for (const click of this.app.input.clicks) {
      if (click.button !== 0) {
        continue;
      }
      const tile = { x: Math.floor(click.x / MAP.tileSize), y: Math.floor(click.y / MAP.tileSize) };
      if (!isWalkable(this.world.map.grid, tile.x, tile.y)) {
        continue;
      }
      if (this.start === null || this.goal !== null) {
        this.start = tile;
        this.goal = null;
        this.result = null;
      } else {
        this.goal = tile;
        this.compare();
      }
      this.showStats();
    }
  }

  compare() {
    const grid = this.world.map.grid;
    const astar = findPath(grid, this.start, this.goal);
    // Cache off: we want to see the real search, not a reused route.
    const route = hpaFindPath(this.world.graph, this.start, this.goal, { useCache: false });
    const hpaPath = route.found ? refineFullPath(this.world.graph, route) : null;
    this.result = { astar: astar, route: route, hpaPath: hpaPath };
  }

  showStats() {
    if (this.result === null) {
      const step = this.start === null ? 'Click a START tile.' : 'Now click a GOAL tile.';
      this.statsElement.textContent = step;
      return;
    }
    const astar = this.result.astar;
    const stats = this.result.route.stats;
    const hpaCost = this.result.route.cost;
    const extra = astar.cost > 0 ? ((hpaCost - astar.cost) / astar.cost) * 100 : 0;
    // All values are numbers we computed, so building HTML from them is safe.
    this.statsElement.innerHTML =
      '<table class="stats-table">' +
      '<tr><th></th><th>A*</th><th>HPA*</th></tr>' +
      '<tr><td>Nodes expanded</td><td>' + astar.nodesExpanded + '</td><td>' +
        stats.abstractNodesExpanded + ' abstract<br>+ ' + stats.insertionNodesExpanded + ' insertion</td></tr>' +
      '<tr><td>Time (ms)</td><td>' + astar.timeMs.toFixed(2) + '</td><td>' + stats.timeMs.toFixed(2) + '</td></tr>' +
      '<tr><td>Path cost</td><td>' + astar.cost.toFixed(1) + '</td><td>' + hpaCost.toFixed(1) + '</td></tr>' +
      '</table>' +
      '<p>HPA* path is ' + extra.toFixed(1) + '% more expensive. Click again for a new start.</p>';
  }

  render(ctx) {
    const world = this.world;
    drawMap(ctx, world.map);
    const abstractTiles = this.result !== null ? this.result.route.abstractTiles : null;
    drawHpaOverlay(ctx, world.graph, abstractTiles);

    if (this.result !== null) {
      // A* underneath and thicker, HPA* on top and thinner, so overlaps stay visible.
      if (this.result.astar.path !== null) {
        drawTilePath(ctx, this.result.astar.path, ASTAR_COLOR, 4);
      }
      if (this.result.hpaPath !== null) {
        drawTilePath(ctx, this.result.hpaPath, HPA_COLOR, 2);
      }
    }
    if (this.start !== null) {
      fillCircle(ctx, tileToPixel(this.start), 5, '#ffffff');
    }
    if (this.goal !== null) {
      fillCircle(ctx, tileToPixel(this.goal), 5, '#000000');
    }

    drawTextPanel(ctx, 8, 8, [
      'AI LAB - A* vs HPA*   (seed ' + this.app.seed + ')',
      'Orange (thick) = A* optimal path',
      'Blue (thin) = HPA* refined path',
      'Blue dashed + circles = HPA* abstract path',
      'Yellow = cluster entrances, white grid = 16x16 clusters',
      'HPA* graph: ' + world.graph.nodes.length + ' nodes, built in ' + world.graph.stats.buildTimeMs.toFixed(0) + ' ms',
      'L: back to game',
    ]);
  }
}
