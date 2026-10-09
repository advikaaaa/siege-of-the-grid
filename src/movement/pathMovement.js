/*
 * pathMovement.js - moves an agent along a path, in kinematic OR steering mode.
 * Course concept: PATH FOLLOWING, and the K switch between kinematic and
 * steering movement for units that travel on planned paths.
 *   - steering:  blend obstacle avoidance + separation + followPath (priority order)
 *   - kinematic: set the velocity with kinematicFollowPath, nothing else
 * Used by: scenes/gameScene.js (Commander, P3); all units in later phases.
 *
 * A "follower" is the memory of one unit's progress along its path:
 *   { path: [points in pixels], index: next waypoint, finished: bool }
 *
 * Pure logic: no DOM or canvas.
 */

import { STEERING } from '../config.js';
import { vec, distance } from '../core/vector.js';
import {
  followPath, obstacleAvoidance, separation, brake, combinePrioritized,
} from './steering.js';
import { kinematicFollowPath } from './kinematic.js';

export function createFollower(pixelPath) {
  // path[0] is the centre of the tile the unit is standing in. Walking back to it
  // first would look odd, so we start at the second point when there is one.
  const firstIndex = Math.min(1, pixelPath.length - 1);
  return { path: pixelPath, index: firstIndex, finished: false };
}

// The path is finished when we are aiming at the last point and are close to it.
function updateFinished(agent, follower) {
  const lastIndex = follower.path.length - 1;
  const lastPoint = follower.path[lastIndex];
  if (follower.index === lastIndex && distance(agent.position, lastPoint) < STEERING.arrivalTolerance) {
    follower.finished = true;
  }
}

// Moves the agent one time step. `follower` may be null (no path: stand still).
// `neighbours` is the list of nearby agents for separation.
export function moveAlongPath(agent, follower, grid, neighbours, movementMode, dt) {
  const hasPath = follower !== null && !follower.finished;

  if (movementMode === 'kinematic') {
    agent.debugForces = [];
    let velocity = vec(0, 0);
    if (hasPath) {
      velocity = kinematicFollowPath(agent, follower, dt);
    }
    agent.applyKinematicVelocity(velocity, dt, grid);
  } else {
    // Without a path the "goal" behavior is simply braking to a stop.
    let goal = { name: 'arrive', force: brake(agent), weight: STEERING.weights.arrive };
    if (hasPath) {
      goal = { name: 'followPath', force: followPath(agent, follower, STEERING.slowingRadius), weight: STEERING.weights.followPath };
    }
    const forces = [
      { name: 'obstacleAvoidance', force: obstacleAvoidance(agent, grid), weight: STEERING.weights.obstacleAvoidance },
      { name: 'separation', force: separation(agent, neighbours), weight: STEERING.weights.separation },
      goal,
    ];
    agent.debugForces = forces;
    agent.applySteeringForce(combinePrioritized(forces, agent.maxForce), dt, grid);
  }

  if (hasPath) {
    updateFinished(agent, follower);
  }
}
