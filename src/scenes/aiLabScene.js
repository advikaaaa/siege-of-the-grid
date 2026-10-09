/*
 * aiLabScene.js - the AI Lab: a place to demonstrate each AI technique in isolation.
 * Course concept: hosts three views (tabs):
 *   Behaviors  - kinematic vs steering, every steering behavior (lab/behaviorPlayground.js)
 *   A* vs HPA* - click two points, compare both paths (lab/pathCompare.js)
 *   Benchmark  - 200 random queries, table + bar chart (lab/benchmarkView.js)
 * Used by: main.js (registered as the 'lab' scene).
 *
 * Each view has the same methods as a scene (enter, exit, update, render), so
 * this file only switches between them and shows/hides the HTML panel.
 *   L - back to the game
 */

import { createRng } from '../core/rng.js';
import { generateMap } from '../world/mapGen.js';
import { buildAbstractGraph } from '../pathfinding/hpa.js';
import { BehaviorPlayground } from './lab/behaviorPlayground.js';
import { PathCompareView } from './lab/pathCompare.js';
import { BenchmarkView } from './lab/benchmarkView.js';

export class AiLabScene {
  constructor(app) {
    this.app = app;
    this.seedWorld = null;  // { seed, map, graph } built on demand
    const getSeedWorld = () => this.getSeedWorld();
    this.views = {
      behaviors: new BehaviorPlayground(app),
      compare: new PathCompareView(app, getSeedWorld),
      benchmark: new BenchmarkView(app, getSeedWorld),
    };
    this.activeName = 'behaviors';
    this.panel = document.getElementById('lab-panel');

    for (const button of this.panel.querySelectorAll('[data-lab-view]')) {
      button.addEventListener('click', () => this.switchView(button.dataset.labView));
    }
  }

  // The pathfinding views use the SAME map as the game (same seed). Generating the
  // map and the HPA* graph takes a moment, so we do it once per seed.
  getSeedWorld() {
    if (this.seedWorld === null || this.seedWorld.seed !== this.app.seed) {
      const map = generateMap(createRng(this.app.seed));
      this.seedWorld = { seed: this.app.seed, map: map, graph: buildAbstractGraph(map.grid) };
    }
    return this.seedWorld;
  }

  activeView() {
    return this.views[this.activeName];
  }

  enter() {
    this.panel.hidden = false;
    this.activeView().enter();
    this.refreshTabs();
  }

  exit() {
    this.activeView().exit();
    this.panel.hidden = true;
  }

  switchView(name) {
    this.activeView().exit();
    this.activeName = name;
    this.activeView().enter();
    this.refreshTabs();
  }

  refreshTabs() {
    for (const button of this.panel.querySelectorAll('[data-lab-view]')) {
      button.classList.toggle('active', button.dataset.labView === this.activeName);
    }
  }

  update(dt) {
    if (this.app.input.wasPressed('l')) {
      this.app.scenes.switchTo('game');
      return;
    }
    this.activeView().update(dt);
  }

  render(ctx) {
    this.activeView().render(ctx);
  }
}
