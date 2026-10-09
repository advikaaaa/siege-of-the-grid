/*
 * overlays.js - debug overlays toggled with the number keys.
 * Course concept: makes the AI's internal data visible for the demo.
 *   1 - paths: raw A* path (orange, through every tile centre) vs smoothed path (cyan)
 *   2 - HPA*: cluster grid, entrances, abstract path
 *   4 - FSM state labels above units
 *   3 - steering: velocity, each weighted force, obstacle-avoidance feelers
 *   5 - bridge reservation timeline
 *   6 - sight radii
 *   7 - spatial hash cells
 * Used by: scenes/gameScene.js, scenes/lab/pathCompare.js.
 */

import { MAP } from '../config.js';
import { tilePathToPixels, tileToPixel } from '../pathfinding/smoothing.js';
import { clusterBounds } from '../pathfinding/hpa.js';
import { fillCircle, strokeCircle, drawLine } from './draw.js';
import { drawSteeringVectors, drawFeelers } from './unitRenderer.js';

export const RAW_PATH_COLOR = '#ff9f1c';
export const SMOOTH_PATH_COLOR = '#00e5ff';
// A* vs HPA* comparison colours (checked for colour-blind separation).
export const ASTAR_COLOR = '#d95926';
export const HPA_COLOR = '#3987e5';
const ENTRANCE_COLOR = '#ffd84d';

function drawPolyline(ctx, points, color, width) {
  for (let i = 1; i < points.length; i++) {
    drawLine(ctx, points[i - 1], points[i], color, width);
  }
}

// Overlay 1, raw part: a tile path straight from A* (orange dots, every tile).
export function drawRawPath(ctx, rawTiles) {
  const raw = tilePathToPixels(rawTiles);
  drawPolyline(ctx, raw, RAW_PATH_COLOR, 1);
  for (const point of raw) {
    fillCircle(ctx, point, 1.5, RAW_PATH_COLOR);
  }
}

// Overlay 1, smoothed part: the waypoints a unit actually follows (cyan), from
// its current waypoint onwards. For HPA* routes this line GROWS while the unit
// walks: that is lazy refinement adding one segment at a time.
export function drawFollowerPath(ctx, follower, position) {
  const points = [position];
  for (let i = follower.index; i < follower.path.length; i++) {
    points.push(follower.path[i]);
  }
  drawPolyline(ctx, points, SMOOTH_PATH_COLOR, 1.5);
  for (let i = 1; i < points.length; i++) {
    fillCircle(ctx, points[i], 2, SMOOTH_PATH_COLOR);
  }
}

// Overlay 2: HPA* clusters (white grid), entrances (yellow node pairs joined by
// their inter-cluster edge) and, if given, an abstract path (blue circles joined
// by DASHED lines: the abstract path is only a plan between entrances, not the
// tiles a unit actually walks).
export function drawHpaOverlay(ctx, graph, abstractTiles) {
  const size = MAP.tileSize;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1;
  for (let cluster = 0; cluster < graph.clusterNodeIds.length; cluster++) {
    const b = clusterBounds(graph, cluster);
    ctx.strokeRect(b.left * size + 0.5, b.top * size + 0.5, (b.right - b.left) * size - 1, (b.bottom - b.top) * size - 1);
  }

  for (let nodeId = 0; nodeId < graph.nodes.length; nodeId++) {
    for (const edge of graph.edges[nodeId]) {
      if (edge.kind === 'inter') {
        drawLine(ctx, tileToPixel(graph.nodes[nodeId]), tileToPixel(graph.nodes[edge.to]), ENTRANCE_COLOR, 2);
      }
    }
  }
  for (const node of graph.nodes) {
    fillCircle(ctx, tileToPixel(node), 2.5, ENTRANCE_COLOR);
  }

  if (abstractTiles !== null && abstractTiles.length > 0) {
    const points = tilePathToPixels(abstractTiles);
    ctx.setLineDash([6, 5]);
    drawPolyline(ctx, points, HPA_COLOR, 2);
    ctx.setLineDash([]);
    for (const point of points) {
      strokeCircle(ctx, point, 5, HPA_COLOR);
    }
  }
}

// Draws a full tile path as a thin line (AI Lab A* vs HPA* comparison).
export function drawTilePath(ctx, tilePath, color, width) {
  drawPolyline(ctx, tilePathToPixels(tilePath), color, width);
}

// A small X marking where a unit is heading (always shown, not an overlay).
export function drawGoalMarker(ctx, point, color) {
  const size = 4;
  drawLine(ctx, { x: point.x - size, y: point.y - size }, { x: point.x + size, y: point.y + size }, color, 2);
  drawLine(ctx, { x: point.x - size, y: point.y + size }, { x: point.x + size, y: point.y - size }, color, 2);
}

// Overlay 4: each unit's current FSM state as a small label above it.
export function drawStateLabels(ctx, units) {
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (const unit of units) {
    if (!unit.alive || unit.brain === null) {
      continue;
    }
    const x = unit.agent.position.x;
    const y = unit.agent.position.y - unit.agent.radius - 8;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const width = ctx.measureText(unit.brain.current).width + 4;
    ctx.fillRect(x - width / 2, y - 8, width, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(unit.brain.current, x, y);
  }
  ctx.textAlign = 'left';
}

// ---- Overlay 5: bridge reservation timeline ------------------------------------

const TIMELINE_SECONDS = 30;   // how far ahead the timeline shows
const BRIDGE_COLORS = ['#ffd84d', '#4dd2ff', '#ff66c4'];

// One lane per bridge at the bottom of the screen. Time runs left to right from
// "now"; every reservation is a bar from its start to its end, its height
// proportional to its size (units), the lane height being the bridge capacity.
export function drawBridgeTimeline(ctx, reservations, bridges, now, capacity) {
  const left = 60;
  const width = 520;
  const laneHeight = 30;
  const top = ctx.canvas.height - bridges.length * (laneHeight + 6) - 26;
  const pixelsPerSecond = width / TIMELINE_SECONDS;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(left - 56, top - 20, width + 66, bridges.length * (laneHeight + 6) + 42);
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px sans-serif';
  ctx.fillText('Bridge reservations (next ' + TIMELINE_SECONDS + ' s, lane height = capacity ' + capacity + ')', left, top - 7);

  for (const bridge of bridges) {
    const laneTop = top + bridge.id * (laneHeight + 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(left, laneTop, width, laneHeight);
    ctx.fillStyle = BRIDGE_COLORS[bridge.id % BRIDGE_COLORS.length];
    ctx.fillText('B' + (bridge.id + 1), left - 30, laneTop + laneHeight / 2 + 4);

    // Stack bars so that overlapping reservations are drawn on top of each other.
    let stackedSize = 0;
    const sorted = reservations.reservationsFor(bridge.id).slice().sort((a, b) => a.start - b.start);
    for (const reservation of sorted) {
      const x0 = left + Math.max(0, reservation.start - now) * pixelsPerSecond;
      const x1 = left + Math.min(TIMELINE_SECONDS, reservation.end - now) * pixelsPerSecond;
      if (x1 <= left || x0 >= left + width) {
        continue;
      }
      const barHeight = (reservation.size / capacity) * laneHeight;
      const y = laneTop + laneHeight - ((stackedSize + reservation.size) / capacity) * laneHeight;
      ctx.fillStyle = BRIDGE_COLORS[bridge.id % BRIDGE_COLORS.length];
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x0, Math.max(laneTop, y), Math.max(2, x1 - x0), barHeight);
      ctx.globalAlpha = 1;
      stackedSize = (stackedSize + reservation.size) % capacity;
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText('now', left - 8, top + bridges.length * (laneHeight + 6) + 10);
  ctx.fillText('+' + TIMELINE_SECONDS + ' s', left + width - 26, top + bridges.length * (laneHeight + 6) + 10);
}

// Small "B1" labels on the map next to each bridge.
export function drawBridgeLabels(ctx, bridges) {
  const size = MAP.tileSize;
  ctx.font = 'bold 11px sans-serif';
  for (const bridge of bridges) {
    ctx.fillStyle = BRIDGE_COLORS[bridge.id % BRIDGE_COLORS.length];
    ctx.fillText('B' + (bridge.id + 1), (bridge.right + 1.5) * size, bridge.top * size - 2);
  }
}

// ---- Overlay 7: spatial hash cells ----------------------------------------------

// Every occupied cell is outlined, with the number of units inside it.
export function drawSpatialHash(ctx, hash) {
  const size = hash.cellSize;
  ctx.font = '9px sans-serif';
  for (const cell of hash.occupiedCells()) {
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cell.column * size + 0.5, cell.row * size + 0.5, size - 1, size - 1);
    ctx.fillStyle = '#ffff66';
    ctx.fillText(String(cell.count), cell.column * size + 2, cell.row * size + 9);
  }
}

// ---- Overlay 3: steering vectors ------------------------------------------------

// For every unit: feelers, velocity (white) and each weighted force in its own
// colour (see FORCE_COLORS in unitRenderer.js). In kinematic mode there are no
// forces, so only the velocity arrows remain: a nice way to SEE the difference.
export function drawAllSteering(ctx, units, grid) {
  for (const unit of units) {
    if (!unit.alive) {
      continue;
    }
    drawFeelers(ctx, unit.agent, grid);
    drawSteeringVectors(ctx, unit.agent);
  }
}

// ---- Overlay 6: sight radii --------------------------------------------------------

// Enemies red, player units blue. Difficulty changes the enemies' circles.
export function drawSightRadii(ctx, units) {
  for (const unit of units) {
    if (!unit.alive) {
      continue;
    }
    const color = unit.team === 'enemy' ? 'rgba(230, 57, 70, 0.35)' : 'rgba(58, 134, 255, 0.35)';
    strokeCircle(ctx, unit.agent.position, unit.sightRange, color);
  }
}
