/*
 * overlays.js - debug overlays toggled with the number keys.
 * Course concept: makes the AI's internal data visible for the demo.
 *   1 - paths: raw A* path (orange, through every tile centre) vs smoothed path (cyan)
 *   (2-7 are added in later phases: HPA* clusters, steering vectors, FSM states,
 *    bridge reservations, sight radii, spatial hash cells.)
 * Used by: scenes/gameScene.js.
 */

import { tilePathToPixels } from '../pathfinding/smoothing.js';
import { fillCircle, drawLine } from './draw.js';

export const RAW_PATH_COLOR = '#ff9f1c';
export const SMOOTH_PATH_COLOR = '#00e5ff';

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

// A small X marking where a unit is heading (always shown, not an overlay).
export function drawGoalMarker(ctx, point, color) {
  const size = 4;
  drawLine(ctx, { x: point.x - size, y: point.y - size }, { x: point.x + size, y: point.y + size }, color, 2);
  drawLine(ctx, { x: point.x - size, y: point.y + size }, { x: point.x + size, y: point.y - size }, color, 2);
}
