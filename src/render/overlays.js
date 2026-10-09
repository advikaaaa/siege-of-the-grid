/*
 * overlays.js - debug overlays toggled with the number keys.
 * Course concept: makes the AI's internal data visible for the demo.
 *   1 - paths: raw A* path (orange, through every tile centre) vs smoothed path (cyan)
 *   2 - HPA*: cluster grid, entrances, abstract path
 *   (3-7 are added in later phases: steering vectors, FSM states,
 *    bridge reservations, sight radii, spatial hash cells.)
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

// Overlay 1. rawTiles and smoothedTiles are tile paths ({ x, y } arrays).
export function drawPathOverlay(ctx, rawTiles, smoothedTiles) {
  const raw = tilePathToPixels(rawTiles);
  drawPolyline(ctx, raw, RAW_PATH_COLOR, 1);
  for (const point of raw) {
    fillCircle(ctx, point, 1.5, RAW_PATH_COLOR);
  }

  const smoothed = tilePathToPixels(smoothedTiles);
  drawPolyline(ctx, smoothed, SMOOTH_PATH_COLOR, 2);
  for (const point of smoothed) {
    fillCircle(ctx, point, 3, SMOOTH_PATH_COLOR);
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
