/*
 * endScene.js - the win / lose screen.
 * Course concept: none directly; it closes the game loop (win: survive 10 waves,
 * lose: base HP reaches 0) and offers to replay the SAME seed, which replays the
 * same map and the same enemy decisions as long as you play the same way.
 * Used by: main.js (registered as 'end'), entered from scenes/gameScene.js.
 *
 * The last frame of the game stays visible, dimmed, behind the HTML panel.
 */

export class EndScene {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('end-panel');
    this.won = false;
    document.getElementById('end-again').addEventListener('click', () => {
      this.app.scenes.switchTo('game', { newGame: true });
    });
    document.getElementById('end-menu').addEventListener('click', () => this.app.scenes.switchTo('menu'));
  }

  // params = { won, summary }
  enter(params) {
    this.won = params.won;
    document.getElementById('end-title').textContent = params.won ? 'Victory!' : 'Defeat';
    document.getElementById('end-summary').textContent = params.summary;
    this.panel.hidden = false;
  }

  exit() {
    this.panel.hidden = true;
  }

  update() {}

  render(ctx) {
    this.app.scenes.scenes.get('game').render(ctx);
    ctx.fillStyle = this.won ? 'rgba(0, 40, 0, 0.55)' : 'rgba(40, 0, 0, 0.55)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
