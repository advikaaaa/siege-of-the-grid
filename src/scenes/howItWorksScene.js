/*
 * howItWorksScene.js - an in-game explanation of every AI concept and its key.
 * Course concept: all of them, in plain words (including why the predictable
 * rule set is exploitable and why more rules would not fix it).
 * Used by: main.js.
 *
 * The text itself is HTML (#howto-panel in index.html), so it is easy to edit
 * and read; this scene only shows/hides it over a dark background.
 */

export class HowItWorksScene {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('howto-panel');
    document.getElementById('howto-back').addEventListener('click', () => this.app.scenes.switchTo('menu'));
  }

  enter() {
    this.panel.hidden = false;
    this.panel.scrollTop = 0;
  }

  exit() {
    this.panel.hidden = true;
  }

  update() {
    if (this.app.input.wasPressed('Escape')) {
      this.app.scenes.switchTo('menu');
    }
  }

  render(ctx) {
    ctx.fillStyle = '#15181d';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
