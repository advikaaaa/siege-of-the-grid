/*
 * formationKeeping.js - "stay in my formation slot", shared by allies and enemy members.
 * Course concept: combines STEERING (slot keeping) with PATHFINDING (catching up).
 * Slot keeping is pure steering: fine when the slot is close. But steering cannot
 * plan around a rock wall, so a unit that has fallen far behind (e.g. the leader
 * went round a lake) asks for a real A* path to the leader first, and switches
 * back to slot keeping once it is close again.
 * Used by: ai/enemyBrain.js, ai/allyBrain.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { AI } from '../config.js';
import { distance } from '../core/vector.js';
import { pixelToTile } from '../world/grid.js';
import { formationSlotPosition } from '../movement/steering.js';
import { slotOrder, pathOrder, followerFromTiles, isOrderFinished } from '../movement/unitMovement.js';

// getAnchor() -> { position, heading };  offset = the unit's slot offset.
// isStillValid() -> false if the brain left the state while a path was computed.
export function keepSlotOrCatchUp(unit, world, getAnchor, offset, dt, isStillValid) {
  const anchor = getAnchor();
  const slot = formationSlotPosition(anchor.position, anchor.heading, offset);
  const farFromSlot = distance(unit.agent.position, slot) > AI.catchUpDistance;

  if (!farFromSlot) {
    if (unit.order.type === 'slot') {
      unit.order.offset = offset; // offsets change when the formation or squad changes
    } else {
      unit.order = slotOrder(getAnchor, offset);
    }
    return;
  }

  // Far away: follow a path to the anchor, refreshed now and then because the
  // anchor keeps moving.
  unit.catchUpTimer -= dt;
  const needsNewPath = unit.order.type !== 'path' || unit.catchUpTimer <= 0 || isOrderFinished(unit.order);
  if (!needsNewPath || unit.waitingForPath) {
    return;
  }
  unit.catchUpTimer = AI.catchUpReplanSeconds;
  unit.waitingForPath = true;
  const goalTile = { x: pixelToTile(anchor.position.x), y: pixelToTile(anchor.position.y) };
  world.requestPath(unit, goalTile, (tilePath) => {
    unit.waitingForPath = false;
    if (tilePath !== null && unit.alive && isStillValid()) {
      unit.order = pathOrder(followerFromTiles(world.grid, tilePath, unit.agent.radius));
    }
  });
}
