/*
 * overlays.js - debug overlays toggled with the number keys.
 * Course concept: makes the AI's internal data visible for the demo.
 *   1 - paths: raw A* path (orange, through every tile centre) vs smoothed path (cyan)
 *   2 - HPA*: cluster grid, entrances, abstract path
 *   4 - FSM state labels above units
 *   (3, 5, 6, 7 are added in later phases: steering vectors, bridge
 *    reservations, sight radii, spatial hash cells.)
 * Used by: scenes/gameScene.js, scenes/lab/pathCompare.js.
 */

import { MAP } from '../config.js';
import { tilePathToPixels, tileToPixel } from '../pathfinding/smoothing.js';
import { clusterBounds } from '../pathfinding/hpa.js';
import { fillCircle, strokeCircle, drawLine } from './draw.js';

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
