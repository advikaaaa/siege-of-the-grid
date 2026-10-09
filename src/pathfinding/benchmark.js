/*
 * benchmark.js - compares A* and HPA* on many random queries on the same map.
 * Course concept: the trade-off of HIERARCHICAL pathfinding - far fewer nodes
 * searched per query, in exchange for precomputation and slightly longer paths.
 * Used by: scenes/lab/benchmarkView.js (AI Lab), tests/hpa.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * For fairness the route cache is OFF here: we measure the algorithm itself, not
 * how often the same cluster pair happened to repeat. The one-time precomputation
 * (graph build) is reported separately.
 */

import { findPath, pathCost } from './astar.js';
import { hpaFindPath, refineFullPath } from './hpa.js';
import { isWalkable } from '../world/grid.js';

function randomWalkableTile(grid, rng) {
  while (true) {
    const tile = { x: rng.int(0, grid.width - 1), y: rng.int(0, grid.height - 1) };
    if (isWalkable(grid, tile.x, tile.y)) {
      return tile;
    }
  }
}

// Returns averages over `queryCount` random start/goal pairs:
// {
//   queries,
//   astar: { nodes, timeMs, cost },
//   hpa:   { nodes, abstractNodes, insertionNodes, timeMs, cost },
//   averageExtraCostPercent, worstExtraCostPercent,
//   hpaFailures   (queries where A* found a path but HPA* did not; should be 0)
// }
export function runPathBenchmark(grid, graph, rng, queryCount) {
  const totals = {
    astarNodes: 0, astarTime: 0, astarCost: 0,
    hpaAbstract: 0, hpaInsertion: 0, hpaTime: 0, hpaCost: 0,
    extraPercent: 0,
  };
  let worstExtraPercent = 0;
  let hpaFailures = 0;
  let measured = 0;

  for (let i = 0; i < queryCount; i++) {
    const start = randomWalkableTile(grid, rng);
    const goal = randomWalkableTile(grid, rng);

    const astar = findPath(grid, start, goal);

    // HPA* time = abstract search + full refinement, so both sides produce a
    // complete tile path.
    const hpaStartTime = performance.now();
    const route = hpaFindPath(graph, start, goal, { useCache: false });
    const hpaPath = route.found ? refineFullPath(graph, route) : null;
    const hpaTime = performance.now() - hpaStartTime;

    if (astar.path === null) {
      continue; // cannot happen on our connected maps, but be safe
    }
    if (hpaPath === null) {
      hpaFailures += 1;
      continue;
    }

    const hpaCost = pathCost(grid, hpaPath);
    // Extra cost of HPA* compared to the optimal A* path, in percent:
    //   (hpaCost - astarCost) / astarCost * 100
    let extraPercent = 0;
    if (astar.cost > 0) {
      extraPercent = ((hpaCost - astar.cost) / astar.cost) * 100;
    }

    measured += 1;
    totals.astarNodes += astar.nodesExpanded;
    totals.astarTime += astar.timeMs;
    totals.astarCost += astar.cost;
    totals.hpaAbstract += route.stats.abstractNodesExpanded;
    totals.hpaInsertion += route.stats.insertionNodesExpanded;
    totals.hpaTime += hpaTime;
    totals.hpaCost += hpaCost;
    totals.extraPercent += extraPercent;
    worstExtraPercent = Math.max(worstExtraPercent, extraPercent);
  }

  const n = Math.max(1, measured);
  return {
    queries: measured,
    astar: {
      nodes: totals.astarNodes / n,
      timeMs: totals.astarTime / n,
      cost: totals.astarCost / n,
    },
    hpa: {
      nodes: (totals.hpaAbstract + totals.hpaInsertion) / n,
      abstractNodes: totals.hpaAbstract / n,
      insertionNodes: totals.hpaInsertion / n,
      timeMs: totals.hpaTime / n,
      cost: totals.hpaCost / n,
    },
    averageExtraCostPercent: totals.extraPercent / n,
    worstExtraCostPercent: worstExtraPercent,
    hpaFailures: hpaFailures,
  };
}
