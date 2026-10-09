/*
 * vector.js - 2D vector math.
 * Course concept: the foundation of NPC movement. Positions, velocities, forces
 * and headings are all 2D vectors, both in kinematic and in steering movement.
 * Used by: movement/* (P2), pathfinding/smoothing.js (P3), ai/* and render/* later.
 *
 * A vector is a plain object { x, y }.
 * Every function returns a NEW vector and never changes its inputs.
 * WHY: if two units shared one vector object and one of them changed it,
 * the other would move too. "Never mutate" makes that bug impossible and makes
 * every function easy to test. The cost (a few small objects per frame) is
 * negligible at our scale.
 */

export function vec(x, y) {
  return { x: x, y: y };
}

// a + b = (ax + bx, ay + by)
export function add(a, b) {
  return vec(a.x + b.x, a.y + b.y);
}

// a - b = (ax - bx, ay - by). "target - position" gives the vector pointing
// from position to target, which is the basis of seek and kinematic movement.
export function subtract(a, b) {
  return vec(a.x - b.x, a.y - b.y);
}

// s * v = (s * vx, s * vy)
export function scale(v, s) {
  return vec(v.x * s, v.y * s);
}

// |v| = sqrt(x^2 + y^2)   (Pythagoras)
export function length(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

// |v|^2 = x^2 + y^2. Cheaper than length() because it skips the square root;
// handy when we only need to compare distances.
export function lengthSquared(v) {
  return v.x * v.x + v.y * v.y;
}

// Distance between two points = |b - a|
export function distance(a, b) {
  return length(subtract(b, a));
}

// Unit vector (length 1) in the same direction: v / |v|.
// A zero vector has no direction, so we return zero instead of dividing by 0.
export function normalize(v) {
  const len = length(v);
  if (len === 0) {
    return vec(0, 0);
  }
  return vec(v.x / len, v.y / len);
}

// If |v| > max, shrink v to length max while keeping its direction.
// Used to clamp velocity to maxSpeed and force to maxForce.
export function limit(v, max) {
  const len = length(v);
  if (len <= max) {
    return vec(v.x, v.y);
  }
  return scale(v, max / len);
}

// a . b = ax * bx + ay * by. Positive when a and b point roughly the same way,
// zero when perpendicular, negative when opposite.
export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

// Angle of v in radians, measured from the +x axis: atan2(y, x).
// On a canvas +y points DOWN, so positive angles turn clockwise on screen.
export function angleOf(v) {
  return Math.atan2(v.y, v.x);
}

// Vector of the given length pointing at the given angle: (cos a, sin a) * len
export function fromAngle(angle, len = 1) {
  return vec(Math.cos(angle) * len, Math.sin(angle) * len);
}

// Rotate v by angle (radians) using the 2D rotation matrix:
//   x' = x cos a - y sin a
//   y' = x sin a + y cos a
// Used later to rotate formation slot offsets by the leader's heading.
export function rotate(v, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vec(v.x * cos - v.y * sin, v.x * sin + v.y * cos);
}
