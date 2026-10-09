/*
 * menuScene.js - the main menu: Play, AI Lab, How It Works, difficulty and seed.
 * Course concept: difficulty scaling is chosen here ("Enemies get smarter, not
 * stronger"), and the seed that makes every demo reproducible is shown here.
 * Used by: main.js (the first scene).
 *
 * The buttons are HTML (#menu-panel in index.html); the canvas behind them shows
 * the current seed's map, dimmed.
 */

import { createRng } from '../core/rng.js';
import { generateMap } from '../world/mapGen.js';
import { drawMap } from '../render/mapRenderer.js';

export class MenuScene {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('menu-panel');
    this.background = null; // { seed, map }

    document.getElementById('menu-play').addEventListener('click', () => {
      this.app.scenes.switchTo('game', { newGame: true });
    });
    document.getElementById('menu-lab').addEventListener('click', () => this.app.scenes.switchTo('lab'));
    document.getElementById('menu-howto').addEventListener('click', () => this.app.scenes.switchTo('howto'));
    document.getElementById('menu-new-seed').addEventListener('click', () => {
      // The next seed is derived from the current one, so even "New seed" is reproducible.
      this.app.seed = createRng(this.app.seed).int(1, 999999);
      this.refresh();
    });
    for (const radio of this.panel.querySelectorAll('input[name="difficulty"]')) {
      radio.addEventListener('change', () => {
        this.app.difficulty = radio.value;
      });
    }
  }

  enter() {
    this.panel.hidden = false;
    this.refresh();
  }

  exit() {
    this.panel.hidden = true;
  }

  refresh() {
    document.getElementById('menu-seed').textContent = String(this.app.seed);
    for (const radio of this.panel.querySelectorAll('input[name="difficulty"]')) {
      radio.checked = radio.value === this.app.difficulty;
    }
  }

  update() {}

  render(ctx) {
    if (this.background === null || this.background.seed !== this.app.seed) {
      this.background = { seed: this.app.seed, map: generateMap(createRng(this.app.seed)) };
    }
    drawMap(ctx, this.background.map);
    ctx.fillStyle = 'rgba(10, 12, 16, 0.6)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
