/*
 * smoothing.js - path smoothing with line-of-sight checks ("string pulling").
 * Course concept: post-processing of grid paths. A* on a grid returns tile-by-tile
 * paths that zig-zag in 45-degree steps. If a unit can walk in a straight line
 * from waypoint A to waypoint C, waypoint B in between is unnecessary. Removing
 * such waypoints gives fewer, longer, more natural straight segments.
 * Used by: game/gameWorld.js, movement/unitMovement.js, pathfinding/hpa.js,
 * render/overlays.js, scenes/lab/pathCompare.js, tests/astar.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * Greedy algorithm:
 *   anchor = first point; keep it.
 *   For each next point i: if there is NO line of sight from anchor to point i,
 *   then point i-1 was the furthest visible point: keep it and make it the new anchor.
 *   Always keep the last point.
 */

import { vec, add, subtract, scale, length, normalize } from '../core/vector.js';
import { isWalkable, tileCost, pixelToTile, tileCenterPixel } from '../world/grid.js';
import { canStep, pathCost } from './astar.js';

// How often (px) we test points along the line. Smaller than a tile, so we cannot
// "jump over" a corner of a blocked tile.
const SAMPLE_STEP = 2;

export function tileToPixel(tile) {
  return vec(tileCenterPixel(tile.x), tileCenterPixel(tile.y));
}

export function tilePathToPixels(tilePath) {
  const points = [];
  for (const tile of tilePath) {
    points.push(tileToPixel(tile));
  }
  return points;
}

// "Thick" line of sight between two tile centres.
// A unit is not a point: it has a radius. So we test three parallel lines: the
// centre line and two lines shifted sideways by `clearance` px. If any of them
// crosses a blocked tile, there is no line of sight.
//
// We also refuse lines that cross terrain more expensive than both endpoints
// (for example a shortcut from grass to grass through a forest). A* deliberately
// went around that forest; smoothing must not undo that decision.
export function hasLineOfSight(grid, fromTile, toTile, clearance) {
  const maxAllowedCost = Math.max(tileCost(grid, fromTile.x, fromTile.y), tileCost(grid, toTile.x, toTile.y));
  const from = tileToPixel(fromTile);
  const to = tileToPixel(toTile);
  const segment = subtract(to, from);
  const segmentLength = length(segment);
  if (segmentLength === 0) {
    return true;
  }

  // Perpendicular of (x, y) is (-y, x); scaled to the clearance distance.
  const direction = normalize(segment);
  const sideways = scale(vec(-direction.y, direction.x), clearance);
  const offsets = [vec(0, 0), sideways, scale(sideways, -1)];

  const sampleCount = Math.ceil(segmentLength / SAMPLE_STEP);
  for (let i = 0; i <= sampleCount; i++) {
    const pointOnCentreLine = add(from, scale(segment, i / sampleCount));
    for (const offset of offsets) {
      const point = add(pointOnCentreLine, offset);
      const tileX = pixelToTile(point.x);
      const tileY = pixelToTile(point.y);
      if (!isWalkable(grid, tileX, tileY)) {
        return false;
      }
      if (tileCost(grid, tileX, tileY) > maxAllowedCost) {
        return false;
      }
    }
  }
  return true;
}

// Returns a shorter list of tiles (a subset of tilePath) where every consecutive
// pair has line of sight.
export function smoothPath(grid, tilePath, clearance) {
  if (tilePath.length <= 2) {
    return tilePath.slice();
  }

  const smoothed = [tilePath[0]];
  let anchor = tilePath[0];

  for (let i = 2; i < tilePath.length; i++) {
    if (!hasLineOfSight(grid, anchor, tilePath[i], clearance)) {
      // tilePath[i - 1] is the last point we could still see: keep it.
      anchor = tilePath[i - 1];
      smoothed.push(anchor);
    }
  }
  smoothed.push(tilePath[tilePath.length - 1]);
  return smoothed;
}

// ---- Tile-level shortcutting (used after HPA* refinement) ---------------------
//
// smoothPath() above returns WAYPOINTS for units to walk. HPA* also needs a
// smoother TILE path, so its cost can be compared with A* fairly. HPA* paths have
// detours because they must pass through fixed entrance tiles; this pass cuts
// them out. (The original HPA* paper does the same "path smoothing" step.)
//
// For each position i we look up to `lookahead` tiles ahead, furthest first. If
// the "octile line" from tile i to tile j is legal AND cheaper than the stretch of
// path it replaces, we use it and continue from j.

// The cheapest-looking straight route between two tiles on 8-directional grids:
// step diagonally while both dx and dy are non-zero, then straight. Returns null
// if any step is illegal (blocked tile or corner-cutting).
function octileLine(grid, from, to) {
  const line = [{ x: from.x, y: from.y }];
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    const stepX = Math.sign(to.x - x);
    const stepY = Math.sign(to.y - y);
    if (!canStep(grid, x, y, stepX, stepY, allowEverywhere)) {
      return null;
    }
    x += stepX;
    y += stepY;
    line.push({ x: x, y: y });
  }
  return line;
}

function allowEverywhere() {
  return true;
}

export function shortcutTilePath(grid, tilePath, lookahead) {
  const result = [tilePath[0]];
  let i = 0;
  while (i < tilePath.length - 1) {
    const shortcut = findShortcut(grid, tilePath, i, lookahead);
    if (shortcut === null) {
      result.push(tilePath[i + 1]);
      i += 1;
    } else {
      // shortcut.line[0] is tile i itself, already in the result.
      for (let k = 1; k < shortcut.line.length; k++) {
        result.push(shortcut.line[k]);
      }
      i = shortcut.endIndex;
    }
  }
  return result;
}

function findShortcut(grid, tilePath, startIndex, lookahead) {
  const furthest = Math.min(tilePath.length - 1, startIndex + lookahead);
  for (let j = furthest; j > startIndex + 1; j--) {
    const line = octileLine(grid, tilePath[startIndex], tilePath[j]);
    if (line === null) {
      continue;
    }
    const oldCost = pathCost(grid, tilePath.slice(startIndex, j + 1));
    // The tiny tolerance stops us from "improving" by floating-point noise.
    if (pathCost(grid, line) < oldCost - 1e-9) {
      return { line: line, endIndex: j };
    }
  }
  return null;
}

