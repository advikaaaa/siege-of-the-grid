/*
 * perception.js - what an NPC can see.
 * Course concept: the SENSING part of the sense -> think -> act loop. Brains do
 * not get magic knowledge: an enemy only reacts to a defender within its sight
 * range AND with a clear line (no rock or water in between).
 * Used by: ai/enemyBrain.js, ai/allyBrain.js, game/gameWorld.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { distance, subtract, add, scale, length } from '../core/vector.js';
import { isWalkableAtPixel } from '../world/grid.js';

const SIGHT_SAMPLE_STEP = 4; // px between checks along the line of sight

// Thin line of sight for VISION: blocked tiles (rock, water) block it, forest
// does not. (Path smoothing uses a stricter "thick" check, see smoothing.js.)
export function hasClearLine(grid, from, to) {
  const segment = subtract(to, from);
  const steps = Math.max(1, Math.ceil(length(segment) / SIGHT_SAMPLE_STEP));
  for (let i = 1; i < steps; i++) {
    if (!isWalkableAtPixel(grid, add(from, scale(segment, i / steps)))) {
      return false;
    }
  }
  return true;
}

// The nearest living unit from `candidates` that `unit` can see within `range`.
// Returns null if none. We sort by distance first so the expensive line check
// runs on the closest candidates only.
export function findVisibleEnemy(unit, candidates, grid, range) {
  const inRange = [];
  for (const other of candidates) {
    if (!other.alive) {
      continue;
    }
    const d = distance(unit.agent.position, other.agent.position);
    if (d <= range) {
      inRange.push({ other: other, distance: d });
    }
  }
  inRange.sort((a, b) => a.distance - b.distance);
  for (const entry of inRange) {
    if (hasClearLine(grid, unit.agent.position, entry.other.agent.position)) {
      return entry.other;
    }
  }
  return null;
}

// Closest point of an axis-aligned rectangle { left, top, right, bottom } to `point`:
// clamp each coordinate into the rectangle.
export function nearestPointOnRect(point, rect) {
  return {
    x: Math.max(rect.left, Math.min(rect.right, point.x)),
    y: Math.max(rect.top, Math.min(rect.bottom, point.y)),
  };
}

export function distanceToRect(point, rect) {
  return distance(point, nearestPointOnRect(point, rect));
}
