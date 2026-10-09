/*
 * kinematic.js - kinematic movement: velocity is set directly, at constant speed.
 * Course concept: KINEMATIC movement (vs steering movement in steering.js).
 *   - No forces, no mass, no acceleration.
 *   - Speed is either 0 or maxSpeed; direction changes instantly.
 *   - Orientation snaps to the direction of motion in one frame.
 * It is simple and exact (the unit always ends precisely on its target), but it
 * looks robotic: no smooth turns, no slowing down, and units do not avoid each other.
 * Used by: scenes/aiLabScene.js (P2); units in later phases when the K toggle
 * selects kinematic mode.
 *
 * Each function returns a VELOCITY (not a force). The caller passes it to
 * agent.applyKinematicVelocity().
 *
 * Pure logic: no DOM or canvas.
 */

import { STEERING } from '../config.js';
import { vec, subtract, scale, length, normalize, fromAngle, distance } from '../core/vector.js';

// Move straight at the target at full speed:
//     v = normalize(target - position) * maxSpeed
// If we are so close that one full step would overshoot (distance <= maxSpeed * dt),
// we choose the exact velocity that lands on the target this step:
//     v = (target - position) / dt
// Next step the distance is 0, so the velocity becomes 0: the unit stops dead,
// with no slowing down beforehand. That abrupt stop is the "kinematic look".
export function kinematicSeek(agent, target, dt) {
  const toTarget = subtract(target, agent.position);
  const distanceToTarget = length(toTarget);
  if (distanceToTarget <= agent.maxSpeed * dt) {
    return scale(toTarget, 1 / dt);
  }
  return scale(normalize(toTarget), agent.maxSpeed);
}

// Run directly away from the threat at full speed while it is within panicRadius:
//     v = normalize(position - threat) * maxSpeed
export function kinematicFlee(agent, threat, panicRadius) {
  const away = subtract(agent.position, threat);
  if (length(away) > panicRadius) {
    return vec(0, 0);
  }
  return scale(normalize(away), agent.maxSpeed);
}

// Kinematic path following: the same waypoint rule as steering followPath
// (advance once within waypointRadius), but each waypoint is approached with
// kinematicSeek: full speed, instant turns, exact stop on the final point.
// follower = { path: [points in pixels], index } (see movement/pathMovement.js).
export function kinematicFollowPath(agent, follower, dt) {
  const lastIndex = follower.path.length - 1;
  while (follower.index < lastIndex &&
         distance(agent.position, follower.path[follower.index]) < STEERING.waypointRadius) {
    follower.index += 1;
  }
  return kinematicSeek(agent, follower.path[follower.index], dt);
}

// Kinematic wander: turn the heading by a small random amount, then move forward
// at full speed:
//     heading += binomial() * maxRotation * dt
//     v = (cos heading, sin heading) * maxSpeed
// binomial() favours small turns, so the path wiggles instead of zig-zagging.
export function kinematicWander(agent, rng, dt, maxRotation) {
  agent.heading += rng.binomial() * maxRotation * dt;
  return fromAngle(agent.heading, agent.maxSpeed);
}
