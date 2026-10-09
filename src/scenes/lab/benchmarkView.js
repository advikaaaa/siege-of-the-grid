/*
 * benchmarkView.js - AI Lab view 3: A* vs HPA* benchmark over random queries.
 * Course concept: the cost/benefit of hierarchical pathfinding, measured, plus an
 * on-screen explanation of why HPA* paths are slightly suboptimal.
 * Used by: scenes/aiLabScene.js.
 *
 * The numbers come from pathfinding/benchmark.js; this file only shows them as a
 * table (HTML panel) and a bar chart (canvas).
 */

import { LAB } from '../../config.js';
import { createRng } from '../../core/rng.js';
import { runPathBenchmark } from '../../pathfinding/benchmark.js';
import { drawBarPanels } from '../../render/barChart.js';
import { ASTAR_COLOR, HPA_COLOR } from '../../render/overlays.js';

const BACKGROUND = '#15181d';

export class BenchmarkView {
  constructor(app, getSeedWorld) {
    this.app = app;
    this.getSeedWorld = getSeedWorld;
    this.world = null;
    this.results = null;
    this.panel = document.getElementById('lab-benchmark');
    this.tableElement = document.getElementById('benchmark-table');
    document.getElementById('benchmark-run').addEventListener('click', () => this.run());
  }

  enter() {
    const world = this.getSeedWorld();
    if (world !== this.world) {
      this.world = world;
      this.results = null;
      this.tableElement.textContent = '';
    }
    this.panel.hidden = false;
  }

  exit() {
    this.panel.hidden = true;
  }

  update() {}

  // Same seed -> same 200 queries every time, so results are comparable between runs.
  run() {
    const rng = createRng(this.app.seed);
    this.results = runPathBenchmark(this.world.map.grid, this.world.graph, rng, LAB.benchmarkQueries);
    this.showTable();
  }

  showTable() {
    const r = this.results;
    // All values are numbers we computed, so building HTML from them is safe.
    this.tableElement.innerHTML =
      '<table class="stats-table">' +
      '<tr><th>Average per query</th><th>A*</th><th>HPA*</th></tr>' +
      '<tr><td>Nodes expanded</td><td>' + r.astar.nodes.toFixed(0) + '</td><td>' + r.hpa.nodes.toFixed(0) + '</td></tr>' +
      '<tr><td>&nbsp;- abstract search</td><td></td><td>' + r.hpa.abstractNodes.toFixed(1) + '</td></tr>' +
      '<tr><td>&nbsp;- start/goal insertion</td><td></td><td>' + r.hpa.insertionNodes.toFixed(0) + '</td></tr>' +
      '<tr><td>Time (ms)</td><td>' + r.astar.timeMs.toFixed(3) + '</td><td>' + r.hpa.timeMs.toFixed(3) + '</td></tr>' +
      '<tr><td>Path cost</td><td>' + r.astar.cost.toFixed(1) + '</td><td>' + r.hpa.cost.toFixed(1) + '</td></tr>' +
      '<tr><td>Extra cost (avg / worst)</td><td>-</td><td>' + r.averageExtraCostPercent.toFixed(1) + '% / ' +
        r.worstExtraCostPercent.toFixed(0) + '%</td></tr>' +
      '</table>' +
      '<p>' + r.queries + ' queries, seed ' + this.app.seed + '. One-time HPA* graph build: ' +
        this.world.graph.stats.buildTimeMs.toFixed(0) + ' ms (' + this.world.graph.nodes.length + ' nodes).</p>';
  }

  render(ctx) {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('A* vs HPA* benchmark', 40, 40);

    if (this.results === null) {
      ctx.font = '14px sans-serif';
      ctx.fillText('Press "Run benchmark" in the panel. (Esc: back to menu)', 40, 70);
      return;
    }

    const r = this.results;
    const bars = (astarValue, hpaValue) => [
      { label: 'A*', value: astarValue, color: ASTAR_COLOR },
      { label: 'HPA*', value: hpaValue, color: HPA_COLOR },
    ];
    drawBarPanels(ctx, 40, 70, 600, [
      { title: 'Nodes expanded (avg per query)', format: (v) => v.toFixed(0), bars: bars(r.astar.nodes, r.hpa.nodes) },
      { title: 'Abstract search only', format: (v) => v.toFixed(0), bars: bars(r.astar.nodes, r.hpa.abstractNodes) },
      { title: 'Time per query (ms)', format: (v) => v.toFixed(3), bars: bars(r.astar.timeMs, r.hpa.timeMs) },
      { title: 'Path cost (avg)', format: (v) => v.toFixed(1), bars: bars(r.astar.cost, r.hpa.cost) },
    ], [{ label: 'A*', color: ASTAR_COLOR }, { label: 'HPA*', color: HPA_COLOR }]);

    // Below the chart, so the HTML panel on the right never covers it.
    this.drawExplanation(ctx, 40, 540, 760);
  }

  drawExplanation(ctx, x, y, width) {
    const r = this.results;
    const heading = (text) => ({ text: text, isHeading: true });
    const point = (text) => ({ text: '- ' + text, isHeading: false });
    const paragraphs = [
      heading('Why HPA* paths are slightly longer (' + r.averageExtraCostPercent.toFixed(1) + '% on average)'),
      point('Every route must pass through fixed entrance tiles (the middle or the ends of each border opening), not wherever the optimal path would cross.'),
      point('Each piece is optimal only INSIDE its cluster. Gluing optimal pieces together does not give a globally optimal path.'),
      point('The shortcut pass after refinement removes most detours (about 11% extra without it).'),
      heading('Why HPA* is not faster on this map'),
      point('The abstract search is tiny: ' + r.hpa.abstractNodes.toFixed(0) + ' nodes vs ' + r.astar.nodes.toFixed(0) + ' for A*.'),
      point('But connecting start and goal to their cluster entrances floods most of two clusters (' + r.hpa.insertionNodes.toFixed(0) + ' tiles).'),
      point('A 96x64 map is small, so A* is already cheap. HPA* pays off on big maps, and when many units share cached routes (enemy squads).'),
    ];
    let lineY = y;
    for (const paragraph of paragraphs) {
      if (paragraph.isHeading && lineY > y) {
        lineY += 14; // extra space before a new section
      }
      ctx.fillStyle = paragraph.isHeading ? '#ffffff' : '#c3c2b7';
      ctx.font = paragraph.isHeading ? 'bold 14px sans-serif' : '13px sans-serif';
      for (const line of wrapText(ctx, paragraph.text, width)) {
        ctx.fillText(line, x, lineY);
        lineY += 18;
      }
      lineY += 4;
    }
  }
}

// Splits text into lines no wider than maxWidth pixels.
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : current + ' ' + word;
    if (ctx.measureText(candidate).width > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}
