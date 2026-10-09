/*
 * behaviorPlayground.js - AI Lab view 1: a playground for movement behaviors.
 * Course concept: kinematic vs steering movement, and every basic steering
 * behavior (seek, flee, arrive, pursue, evade, wander) together with obstacle
 * avoidance and separation, combined with weighted priority blending.
 * Used by: scenes/aiLabScene.js.
 *
 * The controls are plain HTML (#lab-behaviors in index.html): buttons pick the
 * behavior, sliders change maxSpeed, maxForce and the slowing radius.
 *   K - switch kinematic / steering movement
 *
 * The NPCs act relative to the mouse cursor (seek, flee, arrive) or to a target
 * dot that moves in a circle (pursue, evade, so it has a velocity to predict).
 */

import { MAP, AGENT, STEERING, LAB } from '../../config.js';
import { vec, add, scale } from '../../core/vector.js';
import { createRng } from '../../core/rng.js';
import { createGrid, setTile, isWalkableAtPixel } from '../../world/grid.js';
import { TILE } from '../../world/tiles.js';
import { Agent } from '../../movement/agent.js';
import { kinematicSeek, kinematicFlee, kinematicWander } from '../../movement/kinematic.js';
import {
  seek, flee, arrive, pursue, evade, wander, predictPosition,
  obstacleAvoidance, separation, combinePrioritized,
} from '../../movement/steering.js';
import { drawMap } from '../../render/mapRenderer.js';
import { drawTextPanel } from '../../render/hud.js';
import { fillCircle, strokeCircle, drawLine, drawArrow } from '../../render/draw.js';
import {
  drawAgent, drawSteeringVectors, drawFeelers, drawWanderCircle,
} from '../../render/unitRenderer.js';

const AGENT_COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#a8dadc', '#cdb4db'];

const BEHAVIOR_EXPLANATIONS = {
  seek: 'Seek: desired = normalize(target - position) * maxSpeed; ' +
    'force = (desired - velocity) / timeToTarget. It never slows down, so it overshoots and orbits the cursor.',
  flee: 'Flee: desired = normalize(position - threat) * maxSpeed, only inside the panic radius ' +
    '(dashed circle). Outside it the NPC brakes.',
  arrive: 'Arrive: like seek, but inside the slowing radius (dashed circle) ' +
    'desiredSpeed = maxSpeed * distance / slowingRadius, so it stops exactly on the cursor.',
  pursue: 'Pursue: T = distance / maxSpeed (capped), predicted = target + targetVelocity * T, then seek it. ' +
    'Thin lines show each NPC\'s prediction: they cut the corner and intercept.',
  evade: 'Evade: flee from the PREDICTED position of the orbiting dot, inside the panic radius.',
  wander: 'Wander: a circle is projected ahead of the NPC; a point on its rim jitters randomly ' +
    'each step and the NPC seeks it. Small random changes give a smooth stroll.',
};

const KINEMATIC_EXPLANATION = 'KINEMATIC mode: velocity is SET to maxSpeed towards/away from the target. ' +
  'No forces, no acceleration, instant turns, no slowing radius, no obstacle avoidance or separation ' +
  '(watch the NPCs stack on one point).';

// Rock rectangles (in tiles) on an otherwise empty grass field, so obstacle
// avoidance has something to avoid.
const ARENA_WALLS = [
  { x: 30, y: 18, width: 3, height: 22 },
  { x: 54, y: 14, width: 22, height: 3 },
  { x: 62, y: 42, width: 3, height: 14 },
  { x: 12, y: 50, width: 20, height: 3 },
  { x: 44, y: 30, width: 6, height: 6 },
];

function createLabArena() {
  const grid = createGrid(MAP.widthTiles, MAP.heightTiles, TILE.GRASS);
  for (const wall of ARENA_WALLS) {
    for (let y = wall.y; y < wall.y + wall.height; y++) {
      for (let x = wall.x; x < wall.x + wall.width; x++) {
        setTile(grid, x, y, TILE.ROCK);
      }
    }
  }
  // Same shape as a generated map so drawMap() can draw it; no base in the lab.
  return { grid: grid, bridges: [], base: null };
}

export class BehaviorPlayground {
  constructor(app) {
    this.app = app;
    this.arena = createLabArena();
    this.rng = null;
    this.agents = [];
    this.behavior = 'arrive';
    // Slider values. They are copied onto every agent each step.
    this.settings = {
      maxSpeed: AGENT.maxSpeed,
      maxForce: AGENT.maxForce,
      slowingRadius: STEERING.slowingRadius,
    };
    const canvasCentre = vec(app.canvas.width / 2, app.canvas.height / 2);
    this.mouseTarget = canvasCentre;
    // The target dot for pursue/evade orbits the canvas centre.
    this.orbitCentre = canvasCentre;
    this.orbitAngle = 0;
    this.targetDot = { position: canvasCentre, velocity: vec(0, 0) };

    this.panel = document.getElementById('lab-behaviors');
    this.connectControls();
  }

  enter() {
    // A fresh RNG from the same seed: the playground replays identically every time.
    this.rng = createRng(this.app.seed);
    this.spawnAgents();
    this.panel.hidden = false;
    this.refreshControls();
  }

  exit() {
    this.panel.hidden = true;
  }

  spawnAgents() {
    this.agents = [];
    while (this.agents.length < LAB.agentCount) {
      const position = vec(
        this.rng.range(20, this.app.canvas.width - 20),
        this.rng.range(20, this.app.canvas.height - 20),
      );
      if (isWalkableAtPixel(this.arena.grid, position)) {
        const agent = new Agent({ position: position, heading: this.rng.range(0, Math.PI * 2) });
        agent.color = AGENT_COLORS[this.agents.length % AGENT_COLORS.length];
        this.agents.push(agent);
      }
    }
  }

  // ---- HTML controls -----------------------------------------------------------

  connectControls() {
    const buttons = this.panel.querySelectorAll('[data-behavior]');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        this.behavior = button.dataset.behavior;
        this.refreshControls();
      });
    }

    document.getElementById('movement-toggle').addEventListener('click', () => {
      this.toggleMovementMode();
    });
    document.getElementById('lab-respawn').addEventListener('click', () => {
      this.rng = createRng(this.app.seed);
      this.spawnAgents();
    });

    this.connectSlider('slider-max-speed', 'maxSpeed');
    this.connectSlider('slider-max-force', 'maxForce');
    this.connectSlider('slider-slowing-radius', 'slowingRadius');
  }

  connectSlider(elementId, settingName) {
    const slider = document.getElementById(elementId);
    slider.addEventListener('input', () => {
      this.settings[settingName] = Number(slider.value);
      this.refreshControls();
    });
  }

  // Makes the HTML panel show the current state.
  refreshControls() {
    for (const button of this.panel.querySelectorAll('[data-behavior]')) {
      button.classList.toggle('active', button.dataset.behavior === this.behavior);
    }

    const isSteering = this.app.movementMode === 'steering';
    document.getElementById('movement-toggle').textContent =
      'Movement: ' + (isSteering ? 'STEERING' : 'KINEMATIC') + ' (K)';

    this.showSliderValue('slider-max-speed', 'value-max-speed', this.settings.maxSpeed);
    this.showSliderValue('slider-max-force', 'value-max-force', this.settings.maxForce);
    this.showSliderValue('slider-slowing-radius', 'value-slowing-radius', this.settings.slowingRadius);

    document.getElementById('behavior-explanation').textContent =
      isSteering ? BEHAVIOR_EXPLANATIONS[this.behavior] : KINEMATIC_EXPLANATION;
  }

  showSliderValue(sliderId, labelId, value) {
    document.getElementById(sliderId).value = value;
    document.getElementById(labelId).textContent = String(value);
  }

  toggleMovementMode() {
    if (this.app.movementMode === 'steering') {
      this.app.movementMode = 'kinematic';
    } else {
      this.app.movementMode = 'steering';
    }
    this.refreshControls();
  }

  // ---- Simulation --------------------------------------------------------------

  update(dt) {
    const input = this.app.input;
    if (input.wasPressed('k')) {
      this.toggleMovementMode();
    }
    if (input.mouse.insideCanvas) {
      this.mouseTarget = vec(input.mouse.x, input.mouse.y);
    }
    this.moveTargetDot(dt);

    for (const agent of this.agents) {
      agent.maxSpeed = this.settings.maxSpeed;
      agent.maxForce = this.settings.maxForce;
      if (this.app.movementMode === 'steering') {
        this.steerAgent(agent, dt);
      } else {
        this.moveAgentKinematically(agent, dt);
      }
    }
  }

  // Circular motion: position = centre + R (cos a, sin a)
  // Its velocity is the derivative: v = R * angularSpeed * (-sin a, cos a)
  moveTargetDot(dt) {
    this.orbitAngle += LAB.targetOrbitSpeed * dt;
    const radius = LAB.targetOrbitRadius;
    const angle = this.orbitAngle;
    this.targetDot.position = add(this.orbitCentre, vec(Math.cos(angle) * radius, Math.sin(angle) * radius));
    this.targetDot.velocity = scale(vec(-Math.sin(angle), Math.cos(angle)), radius * LAB.targetOrbitSpeed);
  }

  // The force of the currently selected behavior.
  behaviorForce(agent, dt) {
    const dot = this.targetDot;
    switch (this.behavior) {
      case 'seek':
        return seek(agent, this.mouseTarget);
      case 'flee':
        return flee(agent, this.mouseTarget, STEERING.panicRadius);
      case 'arrive':
        return arrive(agent, this.mouseTarget, this.settings.slowingRadius);
      case 'pursue':
        return pursue(agent, dot.position, dot.velocity);
      case 'evade':
        return evade(agent, dot.position, dot.velocity, STEERING.panicRadius);
      case 'wander':
        return wander(agent, this.rng, dt);
      default:
        throw new Error('Unknown behavior: ' + this.behavior);
    }
  }

  // STEERING: collect forces in priority order, blend them, integrate.
  steerAgent(agent, dt) {
    const weights = STEERING.weights;
    const forces = [
      { name: 'obstacleAvoidance', force: obstacleAvoidance(agent, this.arena.grid), weight: weights.obstacleAvoidance },
      { name: 'separation', force: separation(agent, this.agents), weight: weights.separation },
      { name: this.behavior, force: this.behaviorForce(agent, dt), weight: weights[this.behavior] },
    ];
    agent.debugForces = forces;
    const total = combinePrioritized(forces, agent.maxForce);
    agent.applySteeringForce(total, dt, this.arena.grid);
  }

  // KINEMATIC: the same goals, but the velocity is set directly.
  moveAgentKinematically(agent, dt) {
    agent.debugForces = [];
    const velocity = this.kinematicVelocity(agent, dt);
    agent.applyKinematicVelocity(velocity, dt, this.arena.grid);
  }

  kinematicVelocity(agent, dt) {
    const dot = this.targetDot;
    switch (this.behavior) {
      case 'seek':
      case 'arrive':
        // Kinematic movement has no slowing radius: seek and arrive look the same.
        return kinematicSeek(agent, this.mouseTarget, dt);
      case 'flee':
        return kinematicFlee(agent, this.mouseTarget, STEERING.panicRadius);
      case 'pursue':
        return kinematicSeek(agent, this.predictionFor(agent), dt);
      case 'evade':
        return kinematicFlee(agent, this.predictionFor(agent), STEERING.panicRadius);
      case 'wander':
        return kinematicWander(agent, this.rng, dt, STEERING.kinematicMaxRotation);
      default:
        throw new Error('Unknown behavior: ' + this.behavior);
    }
  }

  predictionFor(agent) {
    return predictPosition(agent, this.targetDot.position, this.targetDot.velocity, STEERING.maxPredictionTime);
  }

  // ---- Drawing -------------------------------------------------------------------

  render(ctx) {
    drawMap(ctx, this.arena);
    this.drawTargets(ctx);

    const isSteering = this.app.movementMode === 'steering';
    for (const agent of this.agents) {
      if (this.behavior === 'pursue' || this.behavior === 'evade') {
        const predicted = this.predictionFor(agent);
        drawLine(ctx, agent.position, predicted, 'rgba(255, 255, 255, 0.25)');
        fillCircle(ctx, predicted, 2, '#ffffff');
      }
      if (isSteering) {
        drawFeelers(ctx, agent, this.arena.grid);
        if (this.behavior === 'wander') {
          drawWanderCircle(ctx, agent);
        }
        drawSteeringVectors(ctx, agent);
      }
      drawAgent(ctx, agent, agent.color);
    }

    drawTextPanel(ctx, 8, 8, [
      'AI LAB - behavior playground',
      'Movement: ' + this.app.movementMode.toUpperCase() + '  (K to switch)',
      'Behavior: ' + this.behavior,
      'Seed: ' + this.app.seed + '   FPS: ' + this.app.loopStats.fps,
      'Arrows: white = velocity, red = avoidance,',
      '        orange = separation, other = behavior',
      'Esc: back to menu',
    ]);
  }

  // The thing the NPCs react to: the cursor, or the orbiting dot.
  drawTargets(ctx) {
    const usesDot = this.behavior === 'pursue' || this.behavior === 'evade';
    const isSteering = this.app.movementMode === 'steering';

    if (usesDot) {
      strokeCircle(ctx, this.orbitCentre, LAB.targetOrbitRadius, 'rgba(255, 255, 255, 0.15)');
      fillCircle(ctx, this.targetDot.position, 6, '#ffffff');
      drawArrow(ctx, this.targetDot.position, this.targetDot.velocity, '#ffffff', 0.5);
    } else if (this.behavior !== 'wander') {
      fillCircle(ctx, this.mouseTarget, 4, '#ffffff');
    }

    if (this.behavior === 'arrive' && isSteering) {
      strokeCircle(ctx, this.mouseTarget, this.settings.slowingRadius, '#4dff88', true);
    }
    if (this.behavior === 'flee') {
      strokeCircle(ctx, this.mouseTarget, STEERING.panicRadius, '#c77dff', true);
    }
    if (this.behavior === 'evade') {
      strokeCircle(ctx, this.targetDot.position, STEERING.panicRadius, '#ff66c4', true);
    }
  }
}
