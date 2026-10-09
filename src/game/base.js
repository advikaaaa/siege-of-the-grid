/*
 * base.js - the player's base: HP, its rectangle, and useful points around it.
 * Course concept: the enemies' main GOAL. Their goal chain is
 * "attack the base -> fight defenders in the way -> retreat when badly hurt".
 * Used by: ai/enemyBrain.js, game/gameWorld.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { BASE, COMBAT, MAP } from '../config.js';
import { vec, add, subtract, scale, normalize, length } from '../core/vector.js';
import { nearestPointOnRect } from '../ai/perception.js';

export function createBase() {
  const size = MAP.tileSize;
  const rect = {
    left: BASE.x * size,
    top: BASE.y * size,
    right: (BASE.x + BASE.width) * size,
    bottom: (BASE.y + BASE.height) * size,
  };
  const middleRow = BASE.y + Math.floor(BASE.height / 2);
  return {
    hp: COMBAT.baseMaxHp,
    maxHp: COMBAT.baseMaxHp,
    rect: rect,
    centre: vec((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2),
    // Enemies path to this tile, just in front of the base.
    frontTile: { x: BASE.x + BASE.width + 1, y: middleRow },
    // Guarding allies form up around this point, between the base and the enemy.
    guardPoint: vec(rect.right + 5 * size, (rect.top + rect.bottom) / 2),
  };
}

// Where a sieging unit should stand: on the base edge nearest to it, pushed out
// by its radius so it touches the wall instead of standing inside it.
export function siegePointFor(base, position, radius) {
  const edgePoint = nearestPointOnRect(position, base.rect);
  const outward = subtract(position, edgePoint);
  if (length(outward) === 0) {
    return edgePoint;
  }
  return add(edgePoint, scale(normalize(outward), radius + 1));
}
