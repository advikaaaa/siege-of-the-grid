/*
 * input.js - keyboard and mouse state, converted into game coordinates.
 * Course concept: none directly; it is how the player commands the Commander
 * (click-to-move) and toggles every AI demo (K, P, F, G, 1-7, H...).
 * Used by: main.js (creates it) and every scene (reads it).
 *
 * WHY we queue events instead of reacting inside the event listener:
 * browser events arrive at random moments, but our simulation runs in fixed
 * steps (see loop.js). So listeners only RECORD what happened, and the scene
 * reads it during its next update. After each update step, main.js calls
 * endStep() to clear the "pressed this step" information.
 */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keysDown = new Set();     // keys currently held
    this.keysPressed = new Set();  // keys pressed since the last update step
    this.clicks = [];              // mouse clicks since the last update step
    this.mouse = { x: 0, y: 0, insideCanvas: false };

    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('keyup', (event) => this.handleKeyUp(event));
    canvas.addEventListener('mousemove', (event) => this.handleMouseMove(event));
    canvas.addEventListener('mouseleave', () => {
      this.mouse.insideCanvas = false;
    });
    canvas.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    // Stop the browser menu from opening on right-click over the game.
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // Letters are stored lowercase so "k" and "K" (with Shift/Caps Lock) are the same key.
  // Other keys keep their names, for example "Escape" or "1".
  normalizeKey(key) {
    if (key.length === 1) {
      return key.toLowerCase();
    }
    return key;
  }

  handleKeyDown(event) {
    const key = this.normalizeKey(event.key);
    // Holding a key makes the OS repeat keydown events; only count the first one.
    if (!event.repeat) {
      this.keysPressed.add(key);
    }
    this.keysDown.add(key);
  }

  handleKeyUp(event) {
    this.keysDown.delete(this.normalizeKey(event.key));
  }

  // The canvas draws at 1152x768, but CSS may display it at another size.
  // Convert the mouse position from displayed (CSS) pixels to canvas pixels:
  //   canvasX = (clientX - rect.left) * canvas.width / rect.width
  toCanvasCoordinates(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  handleMouseMove(event) {
    const point = this.toCanvasCoordinates(event);
    this.mouse.x = point.x;
    this.mouse.y = point.y;
    this.mouse.insideCanvas = true;
  }

  handleMouseDown(event) {
    const point = this.toCanvasCoordinates(event);
    // event.button: 0 = left, 1 = middle, 2 = right
    this.clicks.push({ x: point.x, y: point.y, button: event.button });
  }

  isDown(key) {
    return this.keysDown.has(key);
  }

  wasPressed(key) {
    return this.keysPressed.has(key);
  }

  // Called by main.js after every update step.
  endStep() {
    this.keysPressed.clear();
    this.clicks = [];
  }
}
