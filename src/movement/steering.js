/*
 * steering.js - steering behaviors (Craig Reynolds, 1999) and how to combine them.
 * Course concept: STEERING movement. Instead of setting the velocity (kinematic),
 * each behavior returns a FORCE that nudges the velocity a little each step.
 * agent.js integrates it (a = F/m, v += a dt, p += v dt), which gives smooth
 * acceleration, curved turns and natural slowing down.
 * Used by: scenes/aiLabScene.js (P2), unit movement in later phases,
 * render/unitRenderer.js (feelers and wander circle for debug drawing).
 *
 * The core idea of most behaviors:
 *     desiredVelocity = where I would like to be going, at what speed
 *     force = (desiredVelocity - currentVelocity) / timeToTarget
 * "timeToTarget" says how quickly we want to reach the desired velocity
 * (config.js, STEERING.timeToTarget). maxForce then limits it.
 *
 * Every behavior function returns a force vector { x, y } and does not move the agent.
 * Pure logic: no DOM or canvas.
 */

import { STEERING } from '../config.js';
import {
  vec, add, subtract, scale, length, normalize, distance, fromAngle, rotate, dot, limit,
} from '../core/vector.js';
import { isWalkable, pixelToTile } from '../world/grid.js';

// force = (desired - current) / timeToTarget
function forceTowardsVelocity(agent, desiredVelocity) {
  return scale(subtract(desiredVelocity, agent.velocity), 1 / STEERING.timeToTarget);
}

// Brake: the desired velocity is zero, so force = -velocity / timeToTarget.
export function brake(agent) {
  return forceTowardsVelocity(agent, vec(0, 0));
}

// ---- Seek and flee -------------------------------------------------------------

// SEEK: go towards the target at full speed.
//   desired = normalize(target - position) * maxSpeed
// Seek never slows down, so the agent overshoots and circles around the target.
export function seek(agent, target) {
  const toTarget = subtract(target, agent.position);
  const desired = scale(normalize(toTarget), agent.maxSpeed);
  return forceTowardsVelocity(agent, desired);
}

// FLEE: the opposite of seek, run away from the threat at full speed.
//   desired = normalize(position - threat) * maxSpeed
// Outside panicRadius the agent is not scared any more and brakes to a stop.
export function flee(agent, threat, panicRadius) {
  const away = subtract(agent.position, threat);
  if (length(away) > panicRadius) {
    return brake(agent);
  }
  const desired = scale(normalize(away), agent.maxSpeed);
  return forceTowardsVelocity(agent, desired);
}

// ---- Arrive ----------------------------------------------------------------------

// ARRIVE: like seek, but slow down inside the slowing radius and stop on the target.
//   desiredSpeed = maxSpeed                               if distance >= slowingRadius
//   desiredSpeed = maxSpeed * distance / slowingRadius    otherwise
//   desired      = normalize(target - position) * desiredSpeed
// At the target the distance is 0, so desired = 0 and the force brakes.
export function arrive(agent, target, slowingRadius) {
  const toTarget = subtract(target, agent.position);
  const distanceToTarget = length(toTarget);

  let desiredSpeed = agent.maxSpeed;
  if (distanceToTarget < slowingRadius) {
    desiredSpeed = agent.maxSpeed * (distanceToTarget / slowingRadius);
  }

  const desired = scale(normalize(toTarget), desiredSpeed);
  return forceTowardsVelocity(agent, desired);
}

// ---- Pursue and evade --------------------------------------------------------

// Where will a moving target be when we get there?
//   T = distance / maxSpeed        (time to reach its CURRENT position at full speed)
//   T = min(T, maxPredictionTime)  (do not trust predictions too far ahead)
//   predicted = targetPosition + targetVelocity * T
// It assumes the target keeps a constant velocity; a good guess for short times.
export function predictPosition(agent, targetPosition, targetVelocity, maxPredictionTime) {
  const distanceToTarget = distance(agent.position, targetPosition);
  let predictionTime = distanceToTarget / agent.maxSpeed;
  if (predictionTime > maxPredictionTime) {
    predictionTime = maxPredictionTime;
  }
  return add(targetPosition, scale(targetVelocity, predictionTime));
}

// PURSUE: seek the predicted position instead of the current one, so we
// intercept the target instead of chasing its tail.
export function pursue(agent, targetPosition, targetVelocity) {
  const predicted = predictPosition(agent, targetPosition, targetVelocity, STEERING.maxPredictionTime);
  return seek(agent, predicted);
}

// EVADE: flee from the predicted position, so we dodge where the threat is going.
export function evade(agent, threatPosition, threatVelocity, panicRadius) {
  const predicted = predictPosition(agent, threatPosition, threatVelocity, STEERING.maxPredictionTime);
  return flee(agent, predicted, panicRadius);
}

// ---- Wander ------------------------------------------------------------------

// The wander circle sits wanderDistance ahead of the agent. The wander target is a
// point on its rim at angle (heading + wanderAngle).
//   circleCentre = position + (cos h, sin h) * wanderDistance
//   target       = circleCentre + (cos(h + wanderAngle), sin(h + wanderAngle)) * wanderRadius
export function wanderCircle(agent) {
  const centre = add(agent.position, fromAngle(agent.heading, STEERING.wanderDistance));
  const target = add(centre, fromAngle(agent.heading + agent.wanderAngle, STEERING.wanderRadius));
  return { centre: centre, target: target };
}

// WANDER: each step, move the target a little around the rim (random jitter),
// then seek it.
//   wanderAngle += binomial() * wanderJitter * dt
// Because the target is always AHEAD of the agent and moves only a little each
// step, the result is a smooth, natural-looking stroll instead of random jerks.
// Note: this changes agent.wanderAngle (the agent's wander memory).
export function wander(agent, rng, dt) {
  agent.wanderAngle += rng.binomial() * STEERING.wanderJitter * dt;
  const circle = wanderCircle(agent);
  return seek(agent, circle.target);
}

// ---- Obstacle avoidance --------------------------------------------------------

// Three feelers (rays) start at the agent: one straight ahead, two angled to the
// sides. They grow with speed, because a fast agent needs to see further ahead:
//   length = feelerMinLength + feelerLength * (speed / maxSpeed)
export function computeFeelers(agent) {
  const speedRatio = length(agent.velocity) / agent.maxSpeed;
  const frontLength = STEERING.feelerMinLength + STEERING.feelerLength * speedRatio;
  const sideLength = frontLength * STEERING.sideFeelerScale;

  const directions = [
    fromAngle(agent.heading, frontLength),
    fromAngle(agent.heading - STEERING.sideFeelerAngle, sideLength),
    fromAngle(agent.heading + STEERING.sideFeelerAngle, sideLength),
  ];

  const feelers = [];
  for (const direction of directions) {
    feelers.push({ start: agent.position, end: add(agent.position, direction) });
  }
  return feelers;
}

// Walk along a feeler in small steps until we find a blocked tile.
// Returns null when the ray is clear, otherwise
//   { point, distance, normal }
// where `normal` points out of the wall face we hit. We find the face by comparing
// the last free tile with the blocked tile: if we moved in x we hit a vertical
// face, so the normal is (+-1, 0); if we moved in y it is (0, +-1).
export function castFeeler(grid, feeler) {
  const totalLength = distance(feeler.start, feeler.end);
  const stepCount = Math.max(1, Math.ceil(totalLength / STEERING.feelerSampleStep));
  const ray = subtract(feeler.end, feeler.start);

  let previousTileX = pixelToTile(feeler.start.x);
  let previousTileY = pixelToTile(feeler.start.y);

  for (let i = 1; i <= stepCount; i++) {
    const fraction = i / stepCount;
    const point = add(feeler.start, scale(ray, fraction));
    const tileX = pixelToTile(point.x);
    const tileY = pixelToTile(point.y);

    if (!isWalkable(grid, tileX, tileY)) {
      const normal = normalize(vec(previousTileX - tileX, previousTileY - tileY));
      return { point: point, distance: totalLength * fraction, normal: normal };
    }
    previousTileX = tileX;
    previousTileY = tileY;
  }
  return null;
}

// OBSTACLE AVOIDANCE: for each feeler that hits a wall, push along the wall's
// normal. The push is stronger when the wall is closer, when we move more
// directly into it, and when we move faster:
//   closeness = 1 - hitDistance / feelerLength              (1 = wall right here)
//   headOn    = max(0, -dot(wallNormal, normalize(velocity))) (1 = straight at it,
//                                                              0 = parallel or away)
//   speedRatio = |velocity| / maxSpeed                      (a crawl needs little push)
//   strength  = avoidanceForce * closeness * headOn * speedRatio
//
// WHY headOn (both found in headless test runs of the full game):
//  - A unit walking ALONG a wall (smoothed paths often do) keeps touching it with
//    a side feeler. Without headOn it was pushed sideways forever; because
//    avoidance has the highest priority, that push used up the whole force
//    budget and left nothing for path following, so the unit froze.
//  - We use the VELOCITY, not the heading: a unit that has stopped still faces
//    its old direction. If that points at a wall, a heading-based push would pin
//    it there forever (it can never start moving to turn away). A unit that is
//    not moving cannot collide, so it gets no avoidance push at all.
//  - speedRatio: in a 1-tile corridor a unit drifting sideways at 1 px/s got the
//    FULL push from the rock beside it, which again ate the whole force budget.
//    The push needed to avoid a wall grows with the speed you hit it at.
export function obstacleAvoidance(agent, grid) {
  let total = vec(0, 0);
  if (length(agent.velocity) === 0) {
    return total;
  }
  const movingDirection = normalize(agent.velocity);
  const speedRatio = length(agent.velocity) / agent.maxSpeed;
  for (const feeler of computeFeelers(agent)) {
    const hit = castFeeler(grid, feeler);
    if (hit === null) {
      continue;
    }
    const feelerLength = distance(feeler.start, feeler.end);
    const closeness = 1 - hit.distance / feelerLength;
    const headOn = Math.max(0, -dot(hit.normal, movingDirection));
    const strength = STEERING.avoidanceForce * closeness * headOn * speedRatio;
    total = add(total, scale(hit.normal, strength));
  }
  return total;
}

// ---- Separation ----------------------------------------------------------------

// SEPARATION: push away from every neighbour closer than separationRadius.
// The push follows an inverse-square law, like a repelling magnet:
//   force += normalize(position - neighbour) * separationStrength / distance^2
// Twice as close means four times the push, so units almost never overlap but
// barely notice neighbours that are further away.
// `neighbours` may contain the agent itself; it is skipped.
export function separation(agent, neighbours) {
  let total = vec(0, 0);
  for (const other of neighbours) {
    if (other === agent) {
      continue;
    }
    const away = subtract(agent.position, other.position);
    let distanceToOther = length(away);
    if (distanceToOther >= STEERING.separationRadius) {
      continue;
    }
    // Two agents exactly on top of each other have no "away" direction.
    // Pick one (to the right) and a tiny distance so they still separate.
    let direction = normalize(away);
    if (distanceToOther === 0) {
      direction = vec(1, 0);
      distanceToOther = 0.5;
    }
    const strength = STEERING.separationStrength / (distanceToOther * distanceToOther);
    total = add(total, scale(direction, strength));
  }
  return total;
}

// ---- Path following ------------------------------------------------------------

// PATH FOLLOWING: seek the current waypoint; once within waypointRadius, switch to
// the next one. On the LAST waypoint use arrive instead of seek, so the agent
// stops on the goal instead of overshooting it.
//
// follower = { path: [points in pixels], index: current waypoint }. This function
// advances follower.index, so the follower object is the path-following memory.
export function followPath(agent, follower, slowingRadius) {
  const lastIndex = follower.path.length - 1;
  while (follower.index < lastIndex &&
         distance(agent.position, follower.path[follower.index]) < STEERING.waypointRadius) {
    follower.index += 1;
  }

  const waypoint = follower.path[follower.index];
  if (follower.index === lastIndex) {
    return arrive(agent, waypoint, slowingRadius);
  }
  return seek(agent, waypoint);
}

// ---- Formation slot keeping ------------------------------------------------------

// A slot offset is written in the LEADER'S local frame: +x = in front of the
// leader, +y = to the leader's right. To get the slot in world space we rotate
// the offset by the leader's heading and add the leader's position:
//   slot = leaderPosition + rotate(offset, leaderHeading)
// So when the leader turns, the whole formation turns with it.
export function formationSlotPosition(leaderPosition, leaderHeading, slotOffset) {
  return add(leaderPosition, rotate(slotOffset, leaderHeading));
}

// FORMATION: arrive at my slot (arrive, not seek, so members settle into place).
export function keepFormationSlot(agent, leaderPosition, leaderHeading, slotOffset, slowingRadius) {
  const slot = formationSlotPosition(leaderPosition, leaderHeading, slotOffset);
  return arrive(agent, slot, slowingRadius);
}

// ---- Combining behaviors ---------------------------------------------------------

// Weighted blending WITH priority ("weighted truncated running sum with
// prioritization", Buckland, "Programming Game AI by Example").
//
// `weightedForces` is a list of { name, force, weight, maxShare? } in PRIORITY
// order (most important first, e.g. obstacle avoidance, then separation, then
// the goal). We have a budget of maxForce. Going down the list, each weighted
// force takes what it needs from the budget. When the budget runs out, the
// remaining (less important) behaviors get nothing.
// Optional maxShare (0..1) caps how much of the WHOLE budget one behavior may
// take. We give separation maxShare 0.5: in a crowd its inverse-square push can
// be huge, and without a cap it starved path following completely, freezing a
// unit surrounded by its own allies (seen in headless game runs).
//
// WHY not just add everything up? A plain weighted sum lets a strong "seek the
// target" cancel out "don't walk into that rock". With priority, safety
// behaviors are served first and the goal only gets the force that is left.
export function combinePrioritized(weightedForces, maxForce) {
  let total = vec(0, 0);
  let remaining = maxForce;

  for (const item of weightedForces) {
    if (remaining <= 0) {
      break;
    }
    let weighted = scale(item.force, item.weight);
    if (item.maxShare !== undefined) {
      weighted = limit(weighted, maxForce * item.maxShare);
    }
    const magnitude = length(weighted);
    if (magnitude <= remaining) {
      total = add(total, weighted);
      remaining -= magnitude;
    } else {
      // Only part of this force fits: keep its direction, cut its size.
      total = add(total, scale(normalize(weighted), remaining));
      remaining = 0;
    }
  }
  return total;
}
