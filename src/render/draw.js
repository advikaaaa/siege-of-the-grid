/*
 * draw.js - small canvas drawing helpers (circles, lines, arrows).
 * Course concept: none directly; used to visualise vectors, radii and paths so
 * the AI is visible on screen.
 * Used by: render/overlays.js, render/unitRenderer.js, scenes/gameScene.js,
 * scenes/lab/behaviorPlayground.js, scenes/lab/pathCompare.js.
 */

export function fillCircle(ctx, centre, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// dashed = true draws a dashed outline (used for "zones" like slowing radius).
export function strokeCircle(ctx, centre, radius, color, dashed = false) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  if (dashed) {
    ctx.setLineDash([4, 4]);
  }
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawLine(ctx, from, to, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// Draws `vector` as an arrow starting at `from`. Vectors such as forces can be
// hundreds of units long, so `drawScale` shrinks them to a readable size.
export function drawArrow(ctx, from, vector, color, drawScale = 1) {
  const to = { x: from.x + vector.x * drawScale, y: from.y + vector.y * drawScale };
  const arrowLength = Math.hypot(to.x - from.x, to.y - from.y);
  if (arrowLength < 1) {
    return; // too short to see
  }
  drawLine(ctx, from, to, color, 1.5);

  // Arrow head: two short lines at +-150 degrees from the arrow direction.
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = 4;
  for (const side of [-1, 1]) {
    const headAngle = angle + side * (Math.PI * 5 / 6);
    const headEnd = {
      x: to.x + Math.cos(headAngle) * headLength,
      y: to.y + Math.sin(headAngle) * headLength,
    };
    drawLine(ctx, to, headEnd, color, 1.5);
  }
}
