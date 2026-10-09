/*
 * astar.js - A* search on the 8-directional weighted tile grid.
 * Course concept: PATHFINDING with A*.
 *   f(n) = g(n) + h(n)
 *     g(n) = cost of the cheapest known path from the start to n
 *     h(n) = heuristic: an estimate of the remaining cost from n to the goal
 *   A* always expands the open node with the lowest f. If h never OVERestimates
 *   (admissible), the first time the goal is expanded its path is optimal.
 * Used by: pathfinding/benchmark.js, pathfinding/hpa.js, pathfinding/pathService.js,
 * pathfinding/smoothing.js, scenes/lab/pathCompare.js, tests/astar.test.js,
 * tests/hpa.test.js.
 *
 * Grid rules:
 *   - 8 directions. A straight step has length 1, a diagonal step sqrt(2).
 *   - Step cost = cost of the tile we ENTER * step length (grass 1, forest 3).
 *   - No corner-cutting: a diagonal step is only allowed if BOTH orthogonal
 *     neighbours are walkable, so units never clip the corner of a rock.
 *
 * Pure logic: no DOM or canvas.
 */

import { PriorityQueue } from './priorityQueue.js';
import { isWalkable, tileCost } from '../world/grid.js';

const SQRT2 = Math.SQRT2;

// The 8 neighbours of a tile, as (dx, dy) offsets.
export const NEIGHBOR_OFFSETS = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
];

// Octile distance: the exact cost between two tiles on an EMPTY grass grid with
// 8-directional movement. Go diagonally min(dx, dy) times, then straight for the rest:
//   h = sqrt(2) * min(dx, dy) + (max(dx, dy) - min(dx, dy))
//     = (dx + dy) + (sqrt(2) - 2) * min(dx, dy)
// It is admissible because the cheapest tile costs 1, so the real cost can only be
// equal or higher.
export function octileDistance(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
}

// May a unit step from (x, y) by (dx, dy)?
// `isInside(x, y)` optionally restricts the search to a region (HPA* clusters).
export function canStep(grid, x, y, dx, dy, isInside) {
  const nx = x + dx;
  const ny = y + dy;
  if (!isWalkable(grid, nx, ny) || !isInside(nx, ny)) {
    return false;
  }
  const isDiagonal = dx !== 0 && dy !== 0;
  if (isDiagonal) {
    // No corner-cutting: both tiles we would "squeeze between" must be free.
    return isWalkable(grid, nx, y) && isWalkable(grid, x, ny);
  }
  return true;
}

// Cost of the step = cost of the entered tile * step length (1 or sqrt(2)).
export function stepCost(grid, x, y, dx, dy) {
  const isDiagonal = dx !== 0 && dy !== 0;
  const stepLength = isDiagonal ? SQRT2 : 1;
  return tileCost(grid, x + dx, y + dy) * stepLength;
}

function allowEverywhere() {
  return true;
}

// Finds the cheapest path from start to goal (both { x, y } in tiles).
// options.isInside(x, y): optional region restriction (default: whole map).
// Returns {
//   path:          array of { x, y } tiles from start to goal, or null if unreachable
//   cost:          total path cost (Infinity if unreachable)
//   nodesExpanded: how many nodes were taken out of the open list and processed
//   timeMs:        time the search took in milliseconds
// }
export function findPath(grid, start, goal, options = {}) {
  const startTime = performance.now();
  const isInside = options.isInside ?? allowEverywhere;
  const result = { path: null, cost: Infinity, nodesExpanded: 0, timeMs: 0 };

  const endpointsOk = isWalkable(grid, start.x, start.y) && isWalkable(grid, goal.x, goal.y) &&
    isInside(start.x, start.y) && isInside(goal.x, goal.y);
  if (!endpointsOk) {
    result.timeMs = performance.now() - startTime;
    return result;
  }

  // One slot per tile, indexed by node id = y * width + x.
  const nodeCount = grid.width * grid.height;
  const gScore = new Float64Array(nodeCount).fill(Infinity); // best known g per node
  const cameFrom = new Int32Array(nodeCount).fill(-1);        // parent pointer per node
  const closed = new Uint8Array(nodeCount);                   // 1 = already expanded

  const startId = start.y * grid.width + start.x;
  const goalId = goal.y * grid.width + goal.x;
  const open = new PriorityQueue();
  gScore[startId] = 0;
  open.push(startId, octileDistance(start.x, start.y, goal.x, goal.y));

  while (!open.isEmpty()) {
    const currentId = open.pop();

    // We never "decrease" a priority inside the heap. Instead, when we find a
    // cheaper route to a node we push it AGAIN. The old, more expensive copy is
    // still in the heap; when it eventually comes out, the node is already
    // closed, so we just skip it ("lazy deletion").
    if (closed[currentId] === 1) {
      continue;
    }
    closed[currentId] = 1;
    result.nodesExpanded += 1;

    if (currentId === goalId) {
      result.path = reconstructPath(cameFrom, goalId, grid.width);
      result.cost = gScore[goalId];
      break;
    }

    const x = currentId % grid.width;
    const y = Math.floor(currentId / grid.width);

    for (const offset of NEIGHBOR_OFFSETS) {
      if (!canStep(grid, x, y, offset.dx, offset.dy, isInside)) {
        continue;
      }
      const neighborId = (y + offset.dy) * grid.width + (x + offset.dx);
      if (closed[neighborId] === 1) {
        continue;
      }
      // "Relaxation": is going through `current` a cheaper way to reach the neighbour?
      const tentativeG = gScore[currentId] + stepCost(grid, x, y, offset.dx, offset.dy);
      if (tentativeG < gScore[neighborId]) {
        gScore[neighborId] = tentativeG;
        cameFrom[neighborId] = currentId;
        const h = octileDistance(x + offset.dx, y + offset.dy, goal.x, goal.y);
        open.push(neighborId, tentativeG + h); // priority f = g + h
      }
    }
  }

  result.timeMs = performance.now() - startTime;
  return result;
}

// Follow the parent pointers back from the goal to the start, then reverse.
function reconstructPath(cameFrom, goalId, width) {
  const path = [];
  let id = goalId;
  while (id !== -1) {
    path.push({ x: id % width, y: Math.floor(id / width) });
    id = cameFrom[id];
  }
  path.reverse();
  return path;
}

// Total cost of an existing tile path, using the same step costs as A*.
// Used to compare paths (A* vs HPA*, raw vs smoothed) in tests and the benchmark.
export function pathCost(grid, path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    total += stepCost(grid, path[i - 1].x, path[i - 1].y, dx, dy);
  }
  return total;
}
