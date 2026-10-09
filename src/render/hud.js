/*
 * hud.js - the heads-up display: a text panel drawn over the game.
 * Course concept: makes the AI observable (seed, FPS, path statistics, movement
 * mode, AI mode, difficulty). For a viva demo, seeing the numbers matters as
 * much as seeing the units.
 * Used by: scenes/gameScene.js, scenes/lab/behaviorPlayground.js,
 * scenes/lab/pathCompare.js.
 */

const LINE_HEIGHT = 14;
const PADDING = 6;

// Draws a semi-transparent box containing one text line per array entry.
// anchor 'left': (x, y) is the top-left corner; 'right': (x, y) is the top-RIGHT
// corner (used for the panel on the right edge of the screen).
export function drawTextPanel(ctx, x, y, lines, anchor = 'left') {
  ctx.font = '12px monospace';

  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, ctx.measureText(line).width);
  }
  const width = widest + PADDING * 2;
  const height = lines.length * LINE_HEIGHT + PADDING * 2;
  if (anchor === 'right') {
    x -= width;
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + PADDING, y + PADDING + i * LINE_HEIGHT);
  }
  // Restore the default so other drawing code is not surprised.
  ctx.textBaseline = 'alphabetic';
}
