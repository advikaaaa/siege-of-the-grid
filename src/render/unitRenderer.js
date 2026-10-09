/*
 * unitRenderer.js - draws agents and their steering debug information.
 * Course concept: makes steering visible - velocity, each behavior's force in its
 * own colour, obstacle-avoidance feelers and the wander circle.
 * Used by: scenes/aiLabScene.js (P2); the game scene and overlay 3 in later phases.
 */

import { STEERING } from '../config.js';
import { add, fromAngle } from '../core/vector.js';
import { computeFeelers, castFeeler, wanderCircle } from '../movement/steering.js';
import { fillCircle, strokeCircle, drawLine, drawArrow } from './draw.js';

// One colour per behavior, so each force arrow can be told apart.
export const FORCE_COLORS = {
  obstacleAvoidance: '#ff4040',
  separation: '#ff9f1c',
  seek: '#4dd2ff',
  flee: '#c77dff',
  arrive: '#4dff88',
  pursue: '#ffd84d',
  evade: '#ff66c4',
  wander: '#9ad1d4',
  followPath: '#4dd2ff',
  formation: '#b5e48c',
};
export const VELOCITY_COLOR = '#ffffff';

// Forces are large numbers (hundreds), velocities are tens: draw them at
// different scales so both fit on screen.
const VELOCITY_DRAW_SCALE = 0.5;
const FORCE_DRAW_SCALE = 0.08;

// The body is a filled circle; a short line shows which way it is facing.
export function drawAgent(ctx, agent, color) {
  fillCircle(ctx, agent.position, agent.radius, color);
  const nose = add(agent.position, fromAngle(agent.heading, agent.radius + 4));
  drawLine(ctx, agent.position, nose, '#000000', 2);
}

// Velocity (white) plus each weighted force from the last steering step.
export function drawSteeringVectors(ctx, agent) {
  drawArrow(ctx, agent.position, agent.velocity, VELOCITY_COLOR, VELOCITY_DRAW_SCALE);
  for (const item of agent.debugForces) {
    const color = FORCE_COLORS[item.name] ?? '#ffffff';
    const weighted = { x: item.force.x * item.weight, y: item.force.y * item.weight };
    drawArrow(ctx, agent.position, weighted, color, FORCE_DRAW_SCALE);
  }
}

// Feeler rays: grey when clear, red up to the hit point when touching a wall.
export function drawFeelers(ctx, agent, grid) {
  for (const feeler of computeFeelers(agent)) {
    const hit = castFeeler(grid, feeler);
    if (hit === null) {
      drawLine(ctx, feeler.start, feeler.end, 'rgba(255, 255, 255, 0.35)');
    } else {
      drawLine(ctx, feeler.start, hit.point, FORCE_COLORS.obstacleAvoidance, 1.5);
    }
  }
}

export function drawWanderCircle(ctx, agent) {
  const circle = wanderCircle(agent);
  strokeCircle(ctx, circle.centre, STEERING.wanderRadius, 'rgba(255, 255, 255, 0.5)');
  fillCircle(ctx, circle.target, 2.5, FORCE_COLORS.wander);
}

// A small HP bar above a unit: green -> yellow -> red as HP drops.
export function drawHealthBar(ctx, centre, width, offsetY, fraction) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const left = centre.x - width / 2;
  const top = centre.y - offsetY;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(left - 1, top - 1, width + 2, 4);
  ctx.fillStyle = clamped > 0.6 ? '#4caf50' : clamped > 0.3 ? '#ffc107' : '#f44336';
  ctx.fillRect(left, top, width * clamped, 2);
}

// A game unit: body, a white ring for squad leaders, and an HP bar.
export function drawUnit(ctx, unit) {
  if (!unit.alive) {
    return;
  }
  const agent = unit.agent;
  drawAgent(ctx, agent, unit.color);
  if (unit.squad !== null && unit.squad.leader === unit) {
    strokeCircle(ctx, agent.position, agent.radius + 2, '#ffffff');
  }
  drawHealthBar(ctx, agent.position, 12, agent.radius + 5, unit.hp / unit.maxHp);
}
