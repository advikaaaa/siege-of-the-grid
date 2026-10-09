/*
 * unitMovement.js - moves a unit according to its current MOVEMENT ORDER, in
 * kinematic OR steering mode (the K switch applies to every unit).
 * Course concept: the "act" step for movement. Brains decide WHAT to do and set
 * an order; this file decides HOW to move. Orders:
 *   idle   - stand still (steering: brake)
 *   path   - follow a tile path (A*), e.g. Commander click, catching up
 *   route  - follow an HPA* route, refining it LAZILY one segment at a time
 *   slot   - keep a formation slot relative to an anchor (leader or guard point)
 *   arrive - go to a point and stop (chasing a target, flanking, sieging)
 * Any order may also carry evadeFrom (a unit to run away from while moving).
 * A route that crosses a bridge may carry a HOLD: wait at the bridge entrance until
 * the reserved time slot starts (time-aware planning, pathfinding/reservations.js).
 *
 * Steering mode blends, in priority order:
 *   obstacle avoidance > separation > evade (if any) > the order's goal behavior
 * Kinematic mode simply sets the velocity towards the goal (no blending).
 * Used by: game/gameWorld.js, ai/enemyBrain.js, ai/allyBrain.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { STEERING, RESERVATIONS } from '../config.js';
import { vec, distance } from '../core/vector.js';
import {
  followPath, arrive, evade, keepFormationSlot, formationSlotPosition,
  obstacleAvoidance, separation, brake, combinePrioritized,
} from './steering.js';
import { kinematicFollowPath, kinematicSeek } from './kinematic.js';
import { smoothPath, tilePathToPixels } from '../pathfinding/smoothing.js';
import { refineNextSegment } from '../pathfinding/hpa.js';

// ---- Followers (path-following memory) -------------------------------------------

export function createFollower(pixelPath) {
  // path[0] is the centre of the tile the unit is standing in. Walking back to it
  // first would look odd, so we start at the second point when there is one.
  const firstIndex = Math.min(1, pixelPath.length - 1);
  return { path: pixelPath, index: firstIndex, finished: false };
}

// Tile path -> smoothed waypoints -> follower.
export function followerFromTiles(grid, tilePath, clearance) {
  return createFollower(tilePathToPixels(smoothPath(grid, tilePath, clearance)));
}

// ---- Orders ----------------------------------------------------------------------

export function idleOrder() {
  return { type: 'idle', evadeFrom: null };
}

export function pathOrder(follower) {
  return { type: 'path', follower: follower, evadeFrom: null };
}

// An HPA* route: only the first segment is refined now, the rest on demand.
// If the route was planned through a reserved bridge slot, the order also holds
// the unit at the bridge entrance until that slot starts.
export function routeOrder(route, grid, clearance) {
  const firstTiles = refineNextSegment(route);
  const order = {
    type: 'route',
    route: route,
    follower: followerFromTiles(grid, firstTiles, clearance),
    evadeFrom: null,
    crossing: null,
    hold: null,
  };
  if (route.crossing !== undefined) {
    order.crossing = route.crossing;
    order.hold = { point: route.crossing.holdPoint, until: route.crossing.holdUntil };
  }
  return order;
}

// getAnchor() returns { position, heading } of the formation anchor (usually the
// leader). It is a function so the slot always follows the anchor's CURRENT pose.
export function slotOrder(getAnchor, offset) {
  return { type: 'slot', getAnchor: getAnchor, offset: offset, evadeFrom: null };
}

export function arriveOrder(point, slowingRadius) {
  return { type: 'arrive', point: point, slowingRadius: slowingRadius, evadeFrom: null };
}

// True when a path/route order has been walked to its end.
export function isOrderFinished(order) {
  if (order.type === 'path' || order.type === 'route') {
    return order.follower.finished;
  }
  return false;
}

// World position of a slot order's slot right now.
export function slotPosition(order) {
  const anchor = order.getAnchor();
  return formationSlotPosition(anchor.position, anchor.heading, order.offset);
}

// ---- Moving one step ------------------------------------------------------------

// world needs: grid, time, movementMode ('steering' | 'kinematic'), neighboursOf(unit)
// (a list of nearby AGENTS for separation).
export function moveUnit(unit, world, dt) {
  const order = unit.order;
  if (order.type === 'route') {
    extendRouteIfNeeded(unit, order, world.grid);
  }
  unit.isWaiting = isHoldingAtBridge(unit, order, world.time);

  if (world.movementMode === 'kinematic') {
    unit.agent.debugForces = [];
    const velocity = unit.isWaiting ? vec(0, 0) : kinematicVelocity(unit, order, dt);
    unit.agent.applyKinematicVelocity(velocity, dt, world.grid);
  } else {
    const forces = steeringForces(unit, order, world);
    unit.agent.debugForces = forces;
    unit.agent.applySteeringForce(combinePrioritized(forces, unit.agent.maxForce), dt, world.grid);
  }

  if (order.type === 'path' || order.type === 'route') {
    updateFinished(unit.agent, order.follower);
  }
}

// True while the unit stands at its bridge entrance before its reserved slot.
// Once the slot has started the hold is removed for good.
function isHoldingAtBridge(unit, order, now) {
  if (order.hold === undefined || order.hold === null) {
    return false;
  }
  if (now >= order.hold.until) {
    order.hold = null;
    return false;
  }
  return distance(unit.agent.position, order.hold.point) < RESERVATIONS.holdRadius;
}

// LAZY REFINEMENT in action: when the unit is heading for the last known
// waypoint, refine the NEXT abstract segment, smooth it and append it.
function extendRouteIfNeeded(unit, order, grid) {
  const follower = order.follower;
  if (follower.index < follower.path.length - 1) {
    return; // still enough path ahead
  }
  const nextTiles = refineNextSegment(order.route);
  if (nextTiles === null) {
    return; // route fully refined
  }
  const points = tilePathToPixels(smoothPath(grid, nextTiles, unit.agent.radius));
  // points[0] is the joining tile, already the last point of the path.
  for (let i = 1; i < points.length; i++) {
    follower.path.push(points[i]);
  }
  follower.finished = false;
}

function updateFinished(agent, follower) {
  const lastIndex = follower.path.length - 1;
  const closeToEnd = distance(agent.position, follower.path[lastIndex]) < STEERING.arrivalTolerance;
  if (follower.index === lastIndex && closeToEnd) {
    follower.finished = true;
  }
}

function steeringForces(unit, order, world) {
  const agent = unit.agent;
  const weights = STEERING.weights;
  const forces = [
    { name: 'obstacleAvoidance', force: obstacleAvoidance(agent, world.grid), weight: weights.obstacleAvoidance },
    {
      name: 'separation',
      force: separation(agent, world.neighboursOf(unit)),
      weight: weights.separation,
      maxShare: STEERING.separationMaxShare,
    },
  ];
  if (order.evadeFrom !== null && order.evadeFrom.alive) {
    const threat = order.evadeFrom.agent;
    forces.push({ name: 'evade', force: evade(agent, threat.position, threat.velocity, unit.sightRange), weight: weights.evade });
  }
  if (unit.isWaiting) {
    forces.push({ name: 'arrive', force: brake(agent), weight: weights.arrive });
  } else {
    forces.push(goalForce(unit, order));
  }
  return forces;
}

// The behavior that serves the order's goal, as { name, force, weight }.
function goalForce(unit, order) {
  const agent = unit.agent;
  const weights = STEERING.weights;
  switch (order.type) {
    case 'path':
    case 'route':
      if (order.follower.finished) {
        return { name: 'arrive', force: brake(agent), weight: weights.arrive };
      }
      return { name: 'followPath', force: followPath(agent, order.follower, STEERING.slowingRadius), weight: weights.followPath };
    case 'slot': {
      const anchor = order.getAnchor();
      const force = keepFormationSlot(agent, anchor.position, anchor.heading, order.offset, STEERING.slowingRadius);
      return { name: 'formation', force: force, weight: weights.formation };
    }
    case 'arrive':
      return { name: 'arrive', force: arrive(agent, order.point, order.slowingRadius), weight: weights.arrive };
    default:
      return { name: 'arrive', force: brake(agent), weight: weights.arrive };
  }
}

function kinematicVelocity(unit, order, dt) {
  const agent = unit.agent;
  switch (order.type) {
    case 'path':
    case 'route':
      if (order.follower.finished) {
        return vec(0, 0);
      }
      return kinematicFollowPath(agent, order.follower, dt);
    case 'slot':
      return kinematicSeek(agent, slotPosition(order), dt);
    case 'arrive':
      return kinematicSeek(agent, order.point, dt);
    default:
      return vec(0, 0);
  }
}
