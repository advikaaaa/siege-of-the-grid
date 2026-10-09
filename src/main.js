/*
 * main.js - entry point. Creates the shared objects and starts the game loop.
 * Course concept: none directly; it wires the pieces together.
 * Used by: index.html (<script type="module" src="src/main.js">).
 *
 * Data flow of one frame (grows in later phases):
 *   browser events -> Input -> loop.update(dt) -> current scene.update(dt)
 *                                              -> current scene.render(ctx)
 */

import { MAP, DEFAULT_SEED } from './config.js';
import { startLoop } from './core/loop.js';
import { Input } from './core/input.js';
import { SceneManager } from './core/sceneManager.js';
import { GameScene } from './scenes/gameScene.js';

// Lets you reproduce a demo by opening e.g. index.html?seed=4242
function readSeedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(params.get('seed'), 10);
  if (Number.isNaN(seed)) {
    return DEFAULT_SEED;
  }
  return seed;
}

const canvas = document.getElementById('game-canvas');
// The canvas size comes from config.js so it always matches the map size.
canvas.width = MAP.widthTiles * MAP.tileSize;
canvas.height = MAP.heightTiles * MAP.tileSize;
const ctx = canvas.getContext('2d');

// "app" is a small bag of shared objects handed to every scene.
const app = {
  canvas: canvas,
  input: new Input(canvas),
  scenes: new SceneManager(),
  seed: readSeedFromUrl(),
  loopStats: { fps: 0 },
};

app.scenes.register('game', new GameScene(app));
app.scenes.switchTo('game');

function update(dt) {
  app.scenes.update(dt);
  // Key presses and clicks are consumed by exactly one update step.
  app.input.endStep();
}

function render() {
  app.scenes.render(ctx);
}

startLoop(update, render, app.loopStats);
