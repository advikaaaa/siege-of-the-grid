/*
 * combat.js - simple melee combat: reach check, damage, cooldown.
 * Course concept: gives the AI something to decide about. There are no
 * projectiles: a hit lands when the target is within reach and the cooldown is over.
 * Used by: ai/allyBrain.js, ai/enemyBrain.js, game/gameWorld.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { distance } from '../core/vector.js';
import { distanceToRect } from '../ai/perception.js';

// Reach: distance(centres) <= attacker.radius + targetRadius + attackRange
export function isInReach(attacker, targetPosition, targetRadius) {
  const reach = attacker.agent.radius + targetRadius + attacker.attackRange;
  return distance(attacker.agent.position, targetPosition) <= reach;
}

// Count the cooldown down every step.
export function tickCooldown(unit, dt) {
  if (unit.cooldownTimer > 0) {
    unit.cooldownTimer -= dt;
  }
}

// Hits the target if possible. Returns true when a hit landed.
export function tryAttackUnit(attacker, target) {
  if (attacker.cooldownTimer > 0 || !target.alive) {
    return false;
  }
  if (!isInReach(attacker, target.agent.position, target.agent.radius)) {
    return false;
  }
  target.hp -= attacker.damage;
  attacker.cooldownTimer = attacker.attackCooldown;
  return true;
}

// Same for the base, which is a rectangle instead of a circle.
export function tryAttackBase(attacker, base) {
  if (attacker.cooldownTimer > 0 || base.hp <= 0) {
    return false;
  }
  const reach = attacker.agent.radius + attacker.attackRange;
  if (distanceToRect(attacker.agent.position, base.rect) > reach) {
    return false;
  }
  base.hp = Math.max(0, base.hp - attacker.damage);
  attacker.cooldownTimer = attacker.attackCooldown;
  return true;
}
