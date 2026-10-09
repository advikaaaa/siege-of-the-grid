/*
 * hpa.js - Hierarchical Path-Finding A* (HPA*, Botea, Mueller & Schaeffer 2004).
 * Course concept: HIERARCHICAL PATHFINDING. Instead of searching thousands of
 * tiles, we search a small ABSTRACT graph first, then fill in the tile details.
 * Used by: game/gameWorld.js, movement/unitMovement.js, pathfinding/benchmark.js,
 * pathfinding/pathService.js, render/overlays.js, scenes/aiLabScene.js,
 * scenes/lab/pathCompare.js, tests/hpa.test.js, tests/reservations.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * ---------------------------------------------------------------------------
 * PRECOMPUTATION (once per map, buildAbstractGraph):
 *   1. Split the map into 16 x 16 clusters (6 x 4 = 24).
 *   2. ENTRANCES: walk along every border between two neighbouring clusters.
 *      Where tiles on BOTH sides are walkable we have an "opening". A short
 *      opening gets one entrance in its middle; a long one gets two, at its ends.
 *      Each entrance = two abstract nodes (one tile on each side of the border)
 *      joined by an INTER-cluster edge (a single step).
 *   3. INTRA-cluster edges: inside each cluster, run A* restricted to that
 *      cluster between every pair of its entrance nodes. Store the cost AND the
 *      tile path (cache) for each pair that is connected.
 *
 * QUERY (hpaFindPath):
 *   1. Temporarily insert START and GOAL as nodes: connect each to the entrance
 *      nodes of its own cluster (one cluster-limited Dijkstra flood each).
 *   2. Run A* on the abstract graph (a few hundred nodes, not 6144 tiles).
 *   3. The result is a list of abstract SEGMENTS. Refinement turns a segment
 *      into tiles. We refine LAZILY: refineNextSegment() produces only the next
 *      segment when the unit needs it. Because intra-cluster paths were cached
 *      during precomputation, refining is a cheap copy, not a new search.
 *   4. Abstract routes are cached by (startCluster, goalCluster), so a squad
 *      of units going from the same area to the same area shares one route.
 *   5. refineFullPath() (benchmark, AI Lab, tests) additionally runs a shortcut
 *      pass that replaces entrance detours with cheaper straight lines.
 *
 * WHY THE RESULT IS SLIGHTLY SUBOPTIMAL: paths must pass through the fixed
 * entrance tiles and are optimal only INSIDE each cluster. The true optimal path
 * might cross a border elsewhere or cut diagonally across a cluster corner.
 * In exchange, the search is much smaller. The shortcut pass removes most of the
 * gap (measured: about 11% extra cost without it, about 4% with it).
 * ---------------------------------------------------------------------------
 */

import { HPA } from '../config.js';
import {
  findPath, octileDistance, pathCost, canStep, stepCost, NEIGHBOR_OFFSETS,
} from './astar.js';
import { shortcutTilePath } from './smoothing.js';
import { PriorityQueue } from './priorityQueue.js';
import { isWalkable, tileCost } from '../world/grid.js';

// ============================================================================
// Precomputation
// ============================================================================

// Builds the abstract graph. clusterSize and longEntranceLength can be changed
// (tests use tiny clusters on tiny grids).
//
// graph = {
//   grid, clusterSize, clustersX, clustersY,
//   nodes:          [{ id, x, y, cluster }]      abstract nodes (entrance tiles)
//   edges:          [[{ to, cost, path, kind }]] adjacency list, edges[nodeId]
//   nodeIdByTile:   Map tileIndex -> nodeId       (a tile is at most one node)
//   clusterNodeIds: [[nodeId]]                    nodes of each cluster
//   routeCache:     Map "startCluster-goalCluster" -> [nodeId]
//   stats:          { buildTimeMs, entrances, interEdges, intraEdges }
// }
export function buildAbstractGraph(grid, clusterSize = HPA.clusterSize, longEntranceLength = HPA.longEntranceLength) {
  const startTime = performance.now();
  const graph = {
    grid: grid,
    clusterSize: clusterSize,
    clustersX: Math.ceil(grid.width / clusterSize),
    clustersY: Math.ceil(grid.height / clusterSize),
    nodes: [],
    edges: [],
    nodeIdByTile: new Map(),
    clusterNodeIds: [],
    routeCache: new Map(),
    stats: { buildTimeMs: 0, entrances: 0, interEdges: 0, intraEdges: 0 },
  };
  for (let i = 0; i < graph.clustersX * graph.clustersY; i++) {
    graph.clusterNodeIds.push([]);
  }

  findAllEntrances(graph, longEntranceLength);
  connectIntraClusterEdges(graph);

  graph.stats.buildTimeMs = performance.now() - startTime;
  return graph;
}

function clusterIndexOf(graph, x, y) {
  const clusterX = Math.floor(x / graph.clusterSize);
  const clusterY = Math.floor(y / graph.clusterSize);
  return clusterY * graph.clustersX + clusterX;
}

// Tile rectangle of a cluster: left/top inclusive, right/bottom EXCLUSIVE.
export function clusterBounds(graph, clusterIndex) {
  const clusterX = clusterIndex % graph.clustersX;
  const clusterY = Math.floor(clusterIndex / graph.clustersX);
  const left = clusterX * graph.clusterSize;
  const top = clusterY * graph.clusterSize;
  return {
    left: left,
    top: top,
    right: Math.min(left + graph.clusterSize, graph.grid.width),
    bottom: Math.min(top + graph.clusterSize, graph.grid.height),
  };
}

// A function isInside(x, y) for A*, true only for tiles of this cluster.
// This is what makes the precomputed searches "cluster-restricted".
function insideCluster(graph, clusterIndex) {
  const bounds = clusterBounds(graph, clusterIndex);
  return function isInside(x, y) {
    return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
  };
}

function getOrCreateNode(graph, x, y) {
  const tileIndex = y * graph.grid.width + x;
  if (graph.nodeIdByTile.has(tileIndex)) {
    return graph.nodeIdByTile.get(tileIndex);
  }
  const id = graph.nodes.length;
  const cluster = clusterIndexOf(graph, x, y);
  graph.nodes.push({ id: id, x: x, y: y, cluster: cluster });
  graph.edges.push([]);
  graph.clusterNodeIds[cluster].push(id);
  graph.nodeIdByTile.set(tileIndex, id);
  return id;
}

// --- Entrances ---------------------------------------------------------------

function findAllEntrances(graph, longEntranceLength) {
  const size = graph.clusterSize;
  const grid = graph.grid;

  // Vertical borders: between cluster (cx, cy) and its right neighbour (cx + 1, cy).
  for (let clusterX = 0; clusterX < graph.clustersX - 1; clusterX++) {
    const leftX = (clusterX + 1) * size - 1; // last column of the left cluster
    const rightX = leftX + 1;                // first column of the right cluster
    for (let clusterY = 0; clusterY < graph.clustersY; clusterY++) {
      const firstY = clusterY * size;
      const lastY = Math.min(firstY + size, grid.height) - 1;
      const pairAt = (y) => ({ ax: leftX, ay: y, bx: rightX, by: y });
      scanBorder(graph, firstY, lastY, pairAt, longEntranceLength);
    }
  }

  // Horizontal borders: between cluster (cx, cy) and the one below it (cx, cy + 1).
  for (let clusterY = 0; clusterY < graph.clustersY - 1; clusterY++) {
    const topY = (clusterY + 1) * size - 1;  // last row of the upper cluster
    const bottomY = topY + 1;                // first row of the lower cluster
    for (let clusterX = 0; clusterX < graph.clustersX; clusterX++) {
      const firstX = clusterX * size;
      const lastX = Math.min(firstX + size, grid.width) - 1;
      const pairAt = (x) => ({ ax: x, ay: topY, bx: x, by: bottomY });
      scanBorder(graph, firstX, lastX, pairAt, longEntranceLength);
    }
  }
}

// Walk along one border (positions first..last). pairAt(i) gives the two tiles
// facing each other across the border at position i. Consecutive positions where
// both tiles are walkable form one "opening".
function scanBorder(graph, first, last, pairAt, longEntranceLength) {
  let openingStart = -1; // -1 = not currently inside an opening
  // We loop one step past the end so an opening touching the end gets closed too.
  for (let i = first; i <= last + 1; i++) {
    const isOpen = i <= last && isOpenPair(graph.grid, pairAt(i));
    if (isOpen && openingStart === -1) {
      openingStart = i;
    }
    if (!isOpen && openingStart !== -1) {
      addEntrancesForOpening(graph, openingStart, i - 1, pairAt, longEntranceLength);
      openingStart = -1;
    }
  }
}

function isOpenPair(grid, pair) {
  return isWalkable(grid, pair.ax, pair.ay) && isWalkable(grid, pair.bx, pair.by);
}

function addEntrancesForOpening(graph, openingFirst, openingLast, pairAt, longEntranceLength) {
  const openingLength = openingLast - openingFirst + 1;
  if (openingLength < longEntranceLength) {
    const middle = Math.floor((openingFirst + openingLast) / 2);
    addEntrance(graph, pairAt(middle));
  } else {
    addEntrance(graph, pairAt(openingFirst));
    addEntrance(graph, pairAt(openingLast));
  }
}

// One entrance = two nodes facing each other + an inter-cluster edge each way.
// Cost of a step = cost of the tile we ENTER (same rule as A*).
function addEntrance(graph, pair) {
  const grid = graph.grid;
  const a = getOrCreateNode(graph, pair.ax, pair.ay);
  const b = getOrCreateNode(graph, pair.bx, pair.by);
  const tileA = { x: pair.ax, y: pair.ay };
  const tileB = { x: pair.bx, y: pair.by };
  graph.edges[a].push({ to: b, cost: tileCost(grid, tileB.x, tileB.y), path: [tileA, tileB], kind: 'inter' });
  graph.edges[b].push({ to: a, cost: tileCost(grid, tileA.x, tileA.y), path: [tileB, tileA], kind: 'inter' });
  graph.stats.entrances += 1;
  graph.stats.interEdges += 2;
}

// --- Intra-cluster edges --------------------------------------------------------

// For every pair of nodes in the same cluster, run cluster-restricted A* and
// cache the result as two edges (one per direction).
function connectIntraClusterEdges(graph) {
  for (let cluster = 0; cluster < graph.clusterNodeIds.length; cluster++) {
    const ids = graph.clusterNodeIds[cluster];
    const isInside = insideCluster(graph, cluster);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const from = graph.nodes[ids[i]];
        const to = graph.nodes[ids[j]];
        const result = findPath(graph.grid, from, to, { isInside: isInside });
        if (result.path === null) {
          continue; // a rock wall splits this cluster between these two entrances
        }
        // The way back is the same tiles reversed. Its cost can differ a little
        // (we pay for the tiles we ENTER), so we recompute it with pathCost.
        const reversed = result.path.slice().reverse();
        graph.edges[ids[i]].push({ to: ids[j], cost: result.cost, path: result.path, kind: 'intra' });
        graph.edges[ids[j]].push({ to: ids[i], cost: pathCost(graph.grid, reversed), path: reversed, kind: 'intra' });
        graph.stats.intraEdges += 2;
      }
    }
  }
}

// ============================================================================
// Query
// ============================================================================

// Finds an HPA* route from start to goal (tiles). Nothing is refined yet.
// options.useCache: reuse / store abstract routes per (startCluster, goalCluster).
//
// route = {
//   found:         true if a path exists
//   abstractTiles: tiles of the abstract path (start, entrances..., goal), for overlay 2
//   segments:      [{ tiles }]  each segment's tile path (start and end included)
//   nextSegment:   index of the next segment to refine
//   cost:          total cost
//   stats:         { abstractNodesExpanded, insertionNodesExpanded,
//                    refinedTileNodes, timeMs, fromCache }
// }
export function hpaFindPath(graph, start, goal, options = {}) {
  const startTime = performance.now();
  const useCache = options.useCache ?? false;
  const route = {
    found: false,
    abstractTiles: [],
    segments: [],
    nextSegment: 0,
    cost: Infinity,
    stats: { abstractNodesExpanded: 0, insertionNodesExpanded: 0, refinedTileNodes: 0, timeMs: 0, fromCache: false },
  };

  const grid = graph.grid;
  if (isWalkable(grid, start.x, start.y) && isWalkable(grid, goal.x, goal.y)) {
    planRoute(graph, start, goal, useCache, route);
  }

  route.stats.timeMs = performance.now() - startTime;
  return route;
}

function planRoute(graph, start, goal, useCache, route) {
  const startCluster = clusterIndexOf(graph, start.x, start.y);
  const goalCluster = clusterIndexOf(graph, goal.x, goal.y);

  // Same cluster: a small local search is enough (and exact). If the cluster is
  // split by rocks, fall through to the abstract search, which can go around.
  if (startCluster === goalCluster) {
    const local = findPath(graph.grid, start, goal, { isInside: insideCluster(graph, startCluster) });
    route.stats.insertionNodesExpanded += local.nodesExpanded;
    if (local.path !== null) {
      setRoute(route, [start, goal], [{ tiles: local.path }], local.cost);
      return;
    }
  }

  const cacheKey = startCluster + '-' + goalCluster;
  if (useCache && graph.routeCache.has(cacheKey)) {
    if (useCachedRoute(graph, start, goal, graph.routeCache.get(cacheKey), route)) {
      return;
    }
  }

  const nodeIds = searchAbstractGraph(graph, start, goal, route);
  if (useCache && nodeIds !== null && nodeIds.length > 0) {
    graph.routeCache.set(cacheKey, nodeIds);
  }
}

function setRoute(route, abstractTiles, segments, cost) {
  route.found = true;
  route.abstractTiles = abstractTiles;
  route.segments = segments;
  route.cost = cost;
}

// INSERTION: connect a tile (START or GOAL) to every entrance node of its cluster.
//
// Running a separate A* to each entrance would search the same tiles again and
// again. Instead we run ONE Dijkstra "flood" from the tile, limited to the
// cluster, and stop as soon as every entrance node has been reached. Dijkstra
// (A* without a heuristic) is right here because there is no single goal to aim at.
//
// direction 'out': cost of walking tile -> node (used for START)
// direction 'in':  cost of walking node -> tile (used for GOAL). We flood
//   BACKWARDS from the goal: a step from neighbour n into tile c costs
//   tileCost(c), because the cost is paid for the tile you enter.
//
// Returns [{ nodeId, cost, path }], path always in walking order.
function linkTileToCluster(graph, tile, direction, route) {
  const grid = graph.grid;
  const width = grid.width;
  const cluster = clusterIndexOf(graph, tile.x, tile.y);
  const isInside = insideCluster(graph, cluster);

  const gScore = new Float64Array(width * grid.height).fill(Infinity);
  const parent = new Int32Array(width * grid.height).fill(-1);
  const closed = new Uint8Array(width * grid.height);

  // Tiles we still need to reach (the entrance nodes of this cluster).
  const remaining = new Set();
  for (const nodeId of graph.clusterNodeIds[cluster]) {
    remaining.add(graph.nodes[nodeId].y * width + graph.nodes[nodeId].x);
  }

  const originId = tile.y * width + tile.x;
  const open = new PriorityQueue();
  gScore[originId] = 0;
  open.push(originId, 0);

  while (!open.isEmpty() && remaining.size > 0) {
    const currentId = open.pop();
    if (closed[currentId] === 1) {
      continue;
    }
    closed[currentId] = 1;
    route.stats.insertionNodesExpanded += 1;
    remaining.delete(currentId);

    const x = currentId % width;
    const y = Math.floor(currentId / width);
    for (const offset of NEIGHBOR_OFFSETS) {
      // The no-corner-cutting rule is symmetric, so canStep works both ways.
      if (!canStep(grid, x, y, offset.dx, offset.dy, isInside)) {
        continue;
      }
      const neighborId = (y + offset.dy) * width + (x + offset.dx);
      let step = stepCost(grid, x, y, offset.dx, offset.dy); // 'out': enter the neighbour
      if (direction === 'in') {
        // Backwards: the real walk goes neighbour -> current, so we enter `current`.
        step = stepCost(grid, x + offset.dx, y + offset.dy, -offset.dx, -offset.dy);
      }
      const tentativeG = gScore[currentId] + step;
      if (tentativeG < gScore[neighborId]) {
        gScore[neighborId] = tentativeG;
        parent[neighborId] = currentId;
        open.push(neighborId, tentativeG);
      }
    }
  }

  const links = [];
  for (const nodeId of graph.clusterNodeIds[cluster]) {
    const node = graph.nodes[nodeId];
    const nodeTileId = node.y * width + node.x;
    if (gScore[nodeTileId] === Infinity) {
      continue; // walled off from this tile inside the cluster
    }
    // Parent pointers lead from the node back to the origin tile.
    const nodeToOrigin = [];
    let id = nodeTileId;
    while (id !== -1) {
      nodeToOrigin.push({ x: id % width, y: Math.floor(id / width) });
      id = parent[id];
    }
    // 'in' already walks node -> goal; 'out' must be reversed to start -> node.
    const path = direction === 'in' ? nodeToOrigin : nodeToOrigin.reverse();
    links.push({ nodeId: nodeId, cost: gScore[nodeTileId], path: path });
  }
  return links;
}

// A* over the abstract graph. START and GOAL get the temporary ids n and n + 1,
// so the precomputed graph itself is never modified.
// Returns the permanent node ids used by the route (for the cache), or null.
function searchAbstractGraph(graph, start, goal, route) {
  const nodeCount = graph.nodes.length;
  const START = nodeCount;
  const GOAL = nodeCount + 1;

  const startEdges = [];
  for (const link of linkTileToCluster(graph, start, 'out', route)) {
    startEdges.push({ to: link.nodeId, cost: link.cost, path: link.path, kind: 'insert' });
  }
  const edgeToGoal = new Map(); // nodeId -> temporary edge into GOAL
  for (const link of linkTileToCluster(graph, goal, 'in', route)) {
    edgeToGoal.set(link.nodeId, { to: GOAL, cost: link.cost, path: link.path, kind: 'insert' });
  }

  function tileOf(id) {
    if (id === START) return start;
    if (id === GOAL) return goal;
    return graph.nodes[id];
  }

  function edgesOf(id) {
    if (id === START) {
      return startEdges;
    }
    if (id === GOAL) {
      return [];
    }
    if (edgeToGoal.has(id)) {
      return graph.edges[id].concat([edgeToGoal.get(id)]);
    }
    return graph.edges[id];
  }

  // Standard A*, exactly like astar.js, but the "neighbours" are graph edges
  // and the step cost is the edge cost. Heuristic: octile distance (admissible,
  // because every edge cost is at least the octile distance it covers).
  const gScore = new Float64Array(nodeCount + 2).fill(Infinity);
  const closed = new Uint8Array(nodeCount + 2);
  const cameFromEdge = new Array(nodeCount + 2).fill(null);
  const cameFromNode = new Int32Array(nodeCount + 2).fill(-1);
  const open = new PriorityQueue();
  gScore[START] = 0;
  open.push(START, octileDistance(start.x, start.y, goal.x, goal.y));

  while (!open.isEmpty()) {
    const current = open.pop();
    if (closed[current] === 1) {
      continue;
    }
    closed[current] = 1;
    route.stats.abstractNodesExpanded += 1;
    if (current === GOAL) {
      break;
    }
    for (const edge of edgesOf(current)) {
      if (closed[edge.to] === 1) {
        continue;
      }
      const tentativeG = gScore[current] + edge.cost;
      if (tentativeG < gScore[edge.to]) {
        gScore[edge.to] = tentativeG;
        cameFromNode[edge.to] = current;
        cameFromEdge[edge.to] = edge;
        const target = tileOf(edge.to);
        open.push(edge.to, tentativeG + octileDistance(target.x, target.y, goal.x, goal.y));
      }
    }
  }

  if (gScore[GOAL] === Infinity) {
    return null;
  }

  // Walk back from GOAL to START, collecting segments.
  const segments = [];
  const abstractTiles = [];
  const permanentIds = [];
  let id = GOAL;
  while (id !== START) {
    segments.push({ tiles: cameFromEdge[id].path });
    abstractTiles.push(tileOf(id));
    if (id !== GOAL) {
      permanentIds.push(id);
    }
    id = cameFromNode[id];
  }
  abstractTiles.push(start);
  segments.reverse();
  abstractTiles.reverse();
  permanentIds.reverse();

  setRoute(route, abstractTiles, segments, gScore[GOAL]);
  return permanentIds;
}

// Route cache hit: reuse the abstract node sequence of an earlier query between
// the same two clusters. We only need to connect our own start to the first
// cached node and the last cached node to our goal (two small local searches).
// Returns false if that does not work (e.g. start is in a walled-off part of the
// cluster); then the caller does a normal search.
function useCachedRoute(graph, start, goal, nodeIds, route) {
  const first = graph.nodes[nodeIds[0]];
  const last = graph.nodes[nodeIds[nodeIds.length - 1]];
  const head = findPath(graph.grid, start, first, { isInside: insideCluster(graph, first.cluster) });
  const tail = findPath(graph.grid, last, goal, { isInside: insideCluster(graph, last.cluster) });
  route.stats.insertionNodesExpanded += head.nodesExpanded + tail.nodesExpanded;
  if (head.path === null || tail.path === null) {
    return false;
  }

  const segments = [{ tiles: head.path }];
  const abstractTiles = [start, first];
  let cost = head.cost;
  for (let i = 1; i < nodeIds.length; i++) {
    const edge = findEdge(graph, nodeIds[i - 1], nodeIds[i]);
    segments.push({ tiles: edge.path });
    abstractTiles.push(graph.nodes[nodeIds[i]]);
    cost += edge.cost;
  }
  segments.push({ tiles: tail.path });
  abstractTiles.push(goal);
  cost += tail.cost;

  setRoute(route, abstractTiles, segments, cost);
  route.stats.fromCache = true;
  return true;
}

function findEdge(graph, fromId, toId) {
  for (const edge of graph.edges[fromId]) {
    if (edge.to === toId) {
      return edge;
    }
  }
  throw new Error('No abstract edge from ' + fromId + ' to ' + toId);
}

// ============================================================================
// Refinement
// ============================================================================

// LAZY refinement: returns the tile path of the NEXT abstract segment only
// (or null when the route is used up). A unit calls this when it is about to
// finish its current segment, so we never build tiles it will not walk
// (for example if it dies or gets a new order halfway).
export function refineNextSegment(route) {
  if (route.nextSegment >= route.segments.length) {
    return null;
  }
  const tiles = route.segments[route.nextSegment].tiles.slice();
  route.nextSegment += 1;
  route.stats.refinedTileNodes += tiles.length;
  return tiles;
}

// Refines everything at once (benchmark, AI Lab comparison, tests), then removes
// entrance detours with the shortcut pass. Consecutive segments share their
// joining tile, so we skip duplicates while stitching.
// (Units in the game refine lazily instead; the line-of-sight smoothing they
// apply to each refined piece removes most of the same detours visually.)
export function refineFullPath(graph, route) {
  const stitched = [];
  let tiles = refineNextSegment(route);
  while (tiles !== null) {
    for (const tile of tiles) {
      const previous = stitched[stitched.length - 1];
      const isDuplicate = previous !== undefined && previous.x === tile.x && previous.y === tile.y;
      if (!isDuplicate) {
        stitched.push(tile);
      }
    }
    tiles = refineNextSegment(route);
  }
  if (stitched.length === 0) {
    return stitched;
  }
  const shortened = shortcutTilePath(graph.grid, stitched, HPA.shortcutLookahead);
  route.cost = pathCost(graph.grid, shortened);
  return shortened;
}
