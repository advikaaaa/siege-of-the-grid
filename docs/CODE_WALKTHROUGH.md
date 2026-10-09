# Code walkthrough

Read the files in this order. Each step only depends on files from earlier steps,
so nothing is used before it has been explained. For every file: what it is for,
the functions to know by heart, and what you should be able to explain.

---

## Part 1: Foundations

### 1. `src/config.js`
Every tunable number, grouped by topic (`MAP`, `LOOP`, `STEERING`, `UNIT_STATS`,
`COMBAT`, `AI`, `HPA`, `PERFORMANCE`, `RESERVATIONS`, `REPLAN`, `WAVES`...).
**Explain:** why numbers live in one file (tuning without hunting magic numbers);
why the map is 96 x 64 (multiples of 16 -> 6 x 4 HPA* clusters).

### 2. `src/core/vector.js`
Immutable 2D vectors `{ x, y }`: `add`, `subtract`, `scale`, `length`, `normalize`,
`limit`, `dot`, `angleOf`, `fromAngle`, `rotate`.
**Explain:** why functions return new vectors (no shared-object bugs); the rotation
matrix in `rotate` (used for formation slots); `normalize` of a zero vector.

### 3. `src/core/rng.js`
Seeded LCG: `state = (1664525 * state + 1013904223) mod 2^32`. Helpers `range`,
`int`, `chance`, `pick`, `binomial`.
**Explain:** why not `Math.random` (cannot be seeded, demos not reproducible); why
`Math.imul` and `>>> 0`; what `binomial()` returns and why wander uses it.

### 4. `src/core/loop.js`
`startLoop(update, render, stats)`: fixed 1/60 s steps with an accumulator,
capped catch-up of 0.25 s, then one render per browser frame.
**Explain:** the accumulator line by line; the "spiral of death"; why a fixed dt
matters for physics and reproducibility.

### 5. `src/core/input.js`, `src/core/sceneManager.js`
Input records keys and clicks between steps (`wasPressed`, `clicks`, `endStep`) and
converts CSS pixels to canvas pixels. The scene manager keeps one active scene and
calls `exit` / `enter` when switching.
**Explain:** why events are queued instead of handled immediately.

## Part 2: The world

### 6. `src/world/tiles.js`, `src/world/grid.js`
Tile types with costs (grass 1, forest 3, rock/water Infinity, bridge 1). The grid is
a flat `Uint8Array`, `index = y * width + x`. `isWalkable`, `tileCost`,
`pixelToTile`, `tileCenterPixel`.
**Explain:** why a 1D array; why out-of-bounds counts as not walkable.

### 7. `src/world/mapGen.js`
`generateMap(rng)`: bridge rows, meandering river, bridges, rock and forest blobs by
random walk, then `isFullyConnected` (flood fill); regenerate if it fails. Rocks keep
away from edges and water so pockets are rare.
**Explain:** why a 4-direction flood fill is correct for 8-direction movement
without corner-cutting; why the river shifts at most 1 tile per row.

## Part 3: Movement

### 8. `src/movement/agent.js`
`Agent` with `position`, `velocity`, `heading`, `maxSpeed`, `maxForce`, `mass`.
`applySteeringForce` (a = F/m, v += a dt clamped, p += v dt) vs
`applyKinematicVelocity` (velocity replaced). `moveWithWallSliding` moves x and y
separately.
**Explain:** the difference between the two apply functions in one sentence each;
why heading only updates above 1 px/s.

### 9. `src/movement/kinematic.js`
`kinematicSeek` (lands exactly), `kinematicFlee`, `kinematicFollowPath`,
`kinematicWander`. They return VELOCITIES.
**Explain:** the `distance <= maxSpeed * dt` special case.

### 10. `src/movement/steering.js` (most important movement file)
`force = (desired - velocity) / timeToTarget`. Seek, flee, arrive, pursue
(`predictPosition`), evade, wander (`wanderCircle`), obstacle avoidance
(`computeFeelers`, `castFeeler`), separation, `followPath`, formation slots, and
`combinePrioritized`.
**Explain:** arrive's slowing formula; pursue's T = distance / maxSpeed; how a
feeler finds the wall normal; the three factors in avoidance and the bugs that led
to `headOn` and `speedRatio`; the force budget and `maxShare` in `combinePrioritized`.

### 11. AI Lab behavior playground: `src/scenes/lab/behaviorPlayground.js`
Uses steps 8 to 10 directly: `steerAgent` (forces in priority order) and
`moveAgentKinematically`. Good place to watch each behavior alone.

## Part 4: Pathfinding

### 12. `src/pathfinding/priorityQueue.js`
Binary min-heap in an array: children `2i+1`, `2i+2`, parent `floor((i-1)/2)`;
`push` + `siftUp`, `pop` + `siftDown`.
**Explain:** why O(log n); what the heap rule guarantees.

### 13. `src/pathfinding/astar.js` (most important pathfinding file)
`findPath`: gScore / cameFrom / closed arrays, open heap with priority f = g + h,
lazy deletion, stop when the goal is POPPED. `octileDistance`, `canStep` (no
corner-cutting), `stepCost`, `pathCost`. Optional `isInside` for clusters.
**Explain:** every line of the main loop; why the octile heuristic is admissible;
why we stop on pop, not on push.

### 14. `src/pathfinding/smoothing.js`
`hasLineOfSight` (thick, three parallel lines; refuses costlier terrain),
`smoothPath` (greedy string pulling), `shortcutTilePath` (HPA* post-pass with
`octileLine`).
**Explain:** why the line is thick; why forest blocks a shortcut.

### 15. `src/pathfinding/hpa.js`
Precomputation: `buildAbstractGraph` -> `findAllEntrances` / `scanBorder` /
`addEntrancesForOpening` / `addEntrance` -> `connectIntraClusterEdges`.
Query: `hpaFindPath` -> `planRoute` (same cluster, cache, or search) ->
`linkTileToCluster` (Dijkstra flood) -> `searchAbstractGraph` (A* with temporary
START/GOAL ids). Refinement: `refineNextSegment` (lazy), `refineFullPath` (+ shortcut).
**Explain:** short vs long openings; why START and GOAL get temporary ids; what
"lazy" means here; why HPA* is slightly suboptimal and why it is not faster on
this map (benchmark view explains both).

### 16. `src/pathfinding/benchmark.js` and the AI Lab views
`runPathBenchmark` (pure) and `scenes/lab/pathCompare.js`,
`scenes/lab/benchmarkView.js`, `render/barChart.js`.

## Part 5: Decision making

### 17. `src/ai/fsm.js`
`StateMachine`: `start`, `update` (state returns an event), `send` (table lookup,
throws if missing), `changeState` (exit, switch, reset time, enter).
**Explain:** why an explicit transition table.

### 18. `src/ai/decision.js`, `src/ai/difficulty.js`
`weightedChoice` (number line), `chooseEngagementAction`, `predictableAction` (+ the
complexity-fallacy comment). `buildAiSettings` returns `reactionTime`,
`chooseAction`, `chooseFlankSide`, `sharedTargets`, `sightMultiplier`.
**Explain:** what each difficulty changes and what it never changes; why the brain
does not know which mode is active (strategy object).

### 19. `src/ai/perception.js`, `src/ai/formationKeeping.js`
`hasClearLine`, `findVisibleEnemy` (sort by distance, line check nearest first),
`nearestPointOnRect`. `keepSlotOrCatchUp`: slot steering when close, A* path when
more than 60 px away.

### 20. `src/movement/formations.js`, `src/movement/unitMovement.js`
Slot offsets for LINE / V / BOX. Movement orders (`idleOrder`, `pathOrder`,
`routeOrder`, `slotOrder`, `arriveOrder`) and `moveUnit`, which turns the order into
forces or a velocity; `extendRouteIfNeeded` (lazy HPA* in action); bridge holds.
**Explain:** why brains set orders instead of moving units themselves.

### 21. `src/ai/enemyBrain.js` (most important AI file)
`ENEMY_TRANSITIONS` and the seven states. MARCH (goal chain order, leader route vs
member slot), DECIDE (reaction time + dice + shared target), ATTACK, REPOSITION
(`chooseFlankPoint`), RETREAT (route home, evade, regenerate, minimum 3 s), REGROUP,
SIEGE. The behavior tree version is in the header.
**Explain:** one full path through the states with the events; FSM vs behavior tree.

### 22. `src/ai/allyBrain.js`
FOLLOW / ENGAGE / GUARD with the leash and its hysteresis (`isWorthChasing`).
**Explain:** why hysteresis was needed (600+ flips in 3 minutes before it).

## Part 6: The game

### 23. `src/game/units.js`, `combat.js`, `base.js`, `squads.js`, `waves.js`
Unit data (Agent + stats + order + brain + bookkeeping), `isInReach` /
`tryAttackUnit` / `tryAttackBase`, base points, squad leader promotion and slots,
waves `4 + 2(n - 1)` split into squads of at most 6.

### 24. `src/core/spatialHash.js`
`insert`, `queryRadius` (only cells under the circle's bounding box), `occupiedCells`.
**Explain:** n^2 vs roughly n; why we rebuild every step.

### 25. `src/pathfinding/reservations.js` and `src/pathfinding/pathService.js`
`intervalsOverlap`, `ReservationTable` (`reserve`, `release`, `loadDuring`,
`earliestStart`, `expectedWait`, `expire`), `chooseCrossing`. `PathService`:
`enqueue` (one per unit+channel, Commander first), `update` (budget), `findTilePath`
(LRU cache), `findRoute`, `planCrossingRoute`, `combineRoutes`.
**Explain:** the ETA formula; how "wait here vs other bridge" is one comparison;
the SIPP honesty note.

### 26. `src/game/gameWorld.js` (ties everything together)
Constructor (one RNG, map, HPA* graph, hash, reservations, path service, units,
waves). `update`: waves -> hash -> think timers -> brains -> commander -> path
service -> movement -> local replanning -> bridges -> deaths -> end check.
`updateLocalReplanning` / `replanLocally`, `updateBridgeCrossings`,
`updateAllyRespawns`, `setAiOptions`, `spawnStressTest`.
**Explain:** the order of one step and why paths are answered before movement.

## Part 7: Screens and drawing

### 27. `src/render/*`
`draw.js` (primitives), `mapRenderer.js`, `unitRenderer.js` (units, HP bars,
steering arrows, feelers), `overlays.js` (overlays 1 to 7), `hud.js`, `barChart.js`.
Rendering only reads the world; it never changes it.

### 28. `src/scenes/*`, `src/main.js`, `index.html`
Menu, game (keys, overlays table, HUD panels, pause, end), AI Lab host, How It
Works, end screen. `main.js` builds the shared `app` object and starts the loop.

## Part 8: The tests

Read `tests/astar.test.js` (A* checked against a plain Dijkstra), `tests/fsm.test.js`
(brains inside a headless `GameWorld`), and `tests/reservations.test.js`. They show
how each concept is verified, and they are good viva material: "how do you know
your A* is optimal?" -> "the test compares it with Dijkstra on 40 random grids".
