/*
 * agent.js - a moving body: position, velocity, heading, and the physics step.
 * Course concept: the difference between KINEMATIC and STEERING movement lives here.
 *   - Kinematic: velocity is SET directly (applyKinematicVelocity). No acceleration;
 *     speed and direction change instantly.
 *   - Steering:  a FORCE is applied (applySteeringForce). Velocity changes gradually:
 *         acceleration = force / mass                 (Newton: F = m a)
 *         velocity     = velocity + acceleration * dt, clamped to maxSpeed
 *         position     = position + velocity * dt     (explicit Euler integration)
 *         heading      = angle of velocity
 * Used by: scenes/aiLabScene.js (P2); units in later phases wrap an Agent.
 *
 * Pure logic: no DOM or canvas.
 */

import { AGENT } from '../config.js';
import { vec, add, scale, length, limit, angleOf } from '../core/vector.js';
import { isWalkable, pixelToTile } from '../world/grid.js';

// Below this speed (px/s) the velocity direction is meaningless noise,
// so we keep the old heading instead of spinning on the spot.
const MIN_SPEED_FOR_HEADING = 1;

export class Agent {
  // options: { position, maxSpeed, maxForce, mass, radius }. Anything missing
  // falls back to config.js. ("a ?? b" means "a, unless a is null/undefined, then b".)
  constructor(options) {
    this.position = options.position;
    this.velocity = vec(0, 0);
    this.heading = options.heading ?? 0;     // radians, 0 = facing right (+x)
    this.maxSpeed = options.maxSpeed ?? AGENT.maxSpeed;
    this.maxForce = options.maxForce ?? AGENT.maxForce;
    this.mass = options.mass ?? AGENT.mass;
    this.radius = options.radius ?? AGENT.radius;

    // Memory used by the wander behavior (angle of the target on the wander circle,
    // relative to the heading). Each agent needs its own.
    this.wanderAngle = 0;

    // The individual forces of the last steering step, kept only so the debug
    // overlay can draw each one as a coloured arrow: [{ name, force, weight }].
    this.debugForces = [];
  }

  // STEERING movement: integrate a force over one time step dt.
  // grid may be null (no walls); otherwise blocked tiles stop the agent.
  applySteeringForce(force, dt, grid) {
    // a = F / m
    const acceleration = scale(force, 1 / this.mass);
    // v = v + a * dt, then never faster than maxSpeed
    const newVelocity = add(this.velocity, scale(acceleration, dt));
    this.velocity = limit(newVelocity, this.maxSpeed);
    // p = p + v * dt
    this.moveWithWallSliding(scale(this.velocity, dt), grid);
    this.updateHeadingFromVelocity();
  }

  // KINEMATIC movement: the velocity is simply replaced, no force, no mass.
  // The heading snaps to the new direction in the same instant.
  applyKinematicVelocity(velocity, dt, grid) {
    this.velocity = limit(velocity, this.maxSpeed);
    this.moveWithWallSliding(scale(this.velocity, dt), grid);
    this.updateHeadingFromVelocity();
  }

  updateHeadingFromVelocity() {
    if (length(this.velocity) > MIN_SPEED_FOR_HEADING) {
      this.heading = angleOf(this.velocity);
    }
  }

  // Moves by `displacement`, but never into a blocked tile.
  //
  // WHY this exists: steering forces (separation, wander, ...) can push an agent
  // into a rock. Obstacle avoidance makes that rare, but not impossible, so this
  // is the safety net.
  //
  // HOW: we move along x and along y SEPARATELY. If the x move would put the
  // agent's leading edge inside a blocked tile, we cancel only the x move and
  // the x velocity, and keep the y move. The agent then slides along the wall
  // instead of sticking to it.
  moveWithWallSliding(displacement, grid) {
    if (grid === null) {
      this.position = add(this.position, displacement);
      return;
    }

    // --- x axis ---
    const newX = this.position.x + displacement.x;
    // Leading edge: the point of the circle in the direction we move.
    const leadingEdgeX = newX + Math.sign(displacement.x) * this.radius;
    if (this.isFreeAtPixel(grid, leadingEdgeX, this.position.y)) {
      this.position = vec(newX, this.position.y);
    } else {
      this.velocity = vec(0, this.velocity.y);
    }

    // --- y axis ---
    const newY = this.position.y + displacement.y;
    const leadingEdgeY = newY + Math.sign(displacement.y) * this.radius;
    if (this.isFreeAtPixel(grid, this.position.x, leadingEdgeY)) {
      this.position = vec(this.position.x, newY);
    } else {
      this.velocity = vec(this.velocity.x, 0);
    }
  }

  isFreeAtPixel(grid, pixelX, pixelY) {
    return isWalkable(grid, pixelToTile(pixelX), pixelToTile(pixelY));
  }

  // Which tile the agent's centre is in (handy for pathfinding later).
  currentTile() {
    return { x: pixelToTile(this.position.x), y: pixelToTile(this.position.y) };
  }
}
