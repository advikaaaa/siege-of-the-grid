/*
 * barChart.js - a small horizontal bar chart for the A* vs HPA* benchmark.
 * Course concept: presents the hierarchical-pathfinding trade-off (nodes, time,
 * path cost) so it can be read at a glance in the viva.
 * Used by: scenes/lab/benchmarkView.js.
 *
 * The three measures have different units, so each gets its OWN small panel with
 * its own scale ("small multiples"). Putting nodes and milliseconds on one shared
 * axis would make one of them unreadable.
 */

const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#c3c2b7';
const GRID_COLOR = 'rgba(255, 255, 255, 0.15)';
const BAR_HEIGHT = 22;
const BAR_GAP = 6;
const LABEL_WIDTH = 60;

// panels: [{ title, format(value) -> string, bars: [{ label, value, color }] }]
// legend: [{ label, color }]
export function drawBarPanels(ctx, x, y, width, panels, legend) {
  drawLegend(ctx, x, y, legend);
  let panelTop = y + 30;
  for (const panel of panels) {
    drawPanel(ctx, x, panelTop, width, panel);
    panelTop += 30 + panel.bars.length * (BAR_HEIGHT + BAR_GAP) + 20;
  }
}

function drawLegend(ctx, x, y, legend) {
  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'middle';
  let cursorX = x;
  for (const item of legend) {
    ctx.fillStyle = item.color;
    ctx.fillRect(cursorX, y + 2, 12, 12);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fillText(item.label, cursorX + 18, y + 8);
    cursorX += 18 + ctx.measureText(item.label).width + 24;
  }
  ctx.textBaseline = 'alphabetic';
}

function drawPanel(ctx, x, y, width, panel) {
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.fillText(panel.title, x, y + 14);

  // Scale: the largest bar uses the full width (minus room for the value label).
  let maxValue = 0;
  for (const bar of panel.bars) {
    maxValue = Math.max(maxValue, bar.value);
  }
  const barAreaX = x + LABEL_WIDTH;
  const barAreaWidth = width - LABEL_WIDTH - 90;

  // Baseline at zero.
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  const barsTop = y + 24;
  const barsBottom = barsTop + panel.bars.length * (BAR_HEIGHT + BAR_GAP);
  ctx.beginPath();
  ctx.moveTo(barAreaX + 0.5, barsTop);
  ctx.lineTo(barAreaX + 0.5, barsBottom);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  for (let i = 0; i < panel.bars.length; i++) {
    const bar = panel.bars[i];
    const barY = barsTop + i * (BAR_HEIGHT + BAR_GAP);
    const barWidth = maxValue > 0 ? (bar.value / maxValue) * barAreaWidth : 0;

    ctx.font = '13px sans-serif';
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.fillText(bar.label, x, barY + BAR_HEIGHT / 2);

    drawBar(ctx, barAreaX + 1, barY, barWidth, BAR_HEIGHT, bar.color);

    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fillText(panel.format(bar.value), barAreaX + barWidth + 8, barY + BAR_HEIGHT / 2);
  }
  ctx.textBaseline = 'alphabetic';
}

// Bar anchored at the baseline (square left end) with a rounded data end (right).
function drawBar(ctx, x, y, width, height, color) {
  if (width <= 0) {
    return;
  }
  const radius = Math.min(4, width);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x, y + height);
  ctx.closePath();
  ctx.fill();
}
