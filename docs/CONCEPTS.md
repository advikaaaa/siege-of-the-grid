# Concepts

Every course concept in this project, in plain words, with its formula and the
exact file and function that implements it.

---

## 1. Kinematic movement

**Idea.** The unit's velocity is *set* directly: full speed towards the target,
facing the new direction instantly. No mass, no forces, no acceleration. Exact and
cheap, but robotic: instant turns, dead stops, units pile up on one point.

**Formulas.**

```
v = normalize(target - position) * maxSpeed
if distance <= maxSpeed * dt:   v = (target - position) / dt   (land exactly, no overshoot)
heading = atan2(v.y, v.x)                                    (snaps in one frame)
kinematic wander: heading += binomial() * maxRotation * dt,  v = (cos h, sin h) * maxSpeed
```

**Code.** `kinematicSeek`, `kinematicFlee`, `kinematicFollowPath`, `kinematicWander`
in [src/movement/kinematic.js](../src/movement/kinematic.js);
`Agent.applyKinematicVelocity` in [src/movement/agent.js](../src/movement/agent.js).
Key **K** switches every unit between the two modes.

## 2. Steering movement

**Idea.** Behaviors return a *force*. The agent integrates it like a physical body,
so velocity changes gradually: units accelerate, curve and slow down.

**Formulas (explicit Euler integration).**

```
acceleration = force / mass
velocity     = limit(velocity + acceleration * dt, maxSpeed)
position     = position + velocity * dt
heading      = atan2(velocity.y, velocity.x)        (only when speed > 1 px/s)
```

Most behaviors compute a *desired velocity* and steer towards it:

```
force = (desiredVelocity - velocity) / timeToTarget
```

**Code.** `Agent.applySteeringForce` and `moveWithWallSliding` in
[src/movement/agent.js](../src/movement/agent.js).

## 3. The steering behaviors

All in [src/movement/steering.js](../src/movement/steering.js).

| Behavior | Formula | Function |
|---|---|---|
| Seek | desired = normalize(target - p) * maxSpeed | `seek` |
| Flee | desired = normalize(p - threat) * maxSpeed (inside the panic radius, otherwise brake) | `flee` |
| Arrive | desiredSpeed = maxSpeed * min(1, distance / slowingRadius) | `arrive` |
| Pursue | T = min(distance / maxSpeed, maxPredictionTime); seek(target + targetVelocity * T) | `predictPosition`, `pursue` |
| Evade | flee(predicted position) | `evade` |
| Wander | wanderAngle += binomial() * jitter * dt; seek(point on a circle projected ahead) | `wanderCircle`, `wander` |
| Obstacle avoidance | 3 feeler rays; push = avoidanceForce * closeness * headOn * speedRatio along the wall normal | `computeFeelers`, `castFeeler`, `obstacleAvoidance` |
| Separation | sum of normalize(p - neighbour) * strength / distance^2 | `separation` |
| Path following | seek the current waypoint, advance within waypointRadius, arrive at the last | `followPath` |
| Formation slot | slot = leaderPosition + rotate(offset, leaderHeading); arrive(slot) | `formationSlotPosition`, `keepFormationSlot` |

Obstacle avoidance terms: `closeness = 1 - hitDistance / feelerLength`,
`headOn = max(0, -dot(wallNormal, normalize(velocity)))`,
`speedRatio = |velocity| / maxSpeed`. The last two were added after headless test
runs showed units freezing beside walls (see the comment above `obstacleAvoidance`).

**Combining behaviors.** `combinePrioritized` uses a *weighted truncated running sum
with prioritization*: forces are visited in priority order (obstacle avoidance,
separation, evade, then the goal behavior). Each takes `weight * force` out of a
budget of `maxForce` until the budget is spent. An optional `maxShare` caps one
behavior's share (separation may use at most 50%, so a crowd can never starve path
following). Weights live in `STEERING.weights` in [src/config.js](../src/config.js).
The game-side blending is in `steeringForces` in
[src/movement/unitMovement.js](../src/movement/unitMovement.js).

## 4. A* pathfinding

**Idea.** Search the tile graph, always expanding the open node with the lowest
estimated total cost. With an admissible heuristic the first time the goal is
expanded its path is optimal.

**Formulas.**

```
f(n) = g(n) + h(n)
step cost = cost of the ENTERED tile * (1 straight, sqrt(2) diagonal)
octile heuristic h = (dx + dy) + (sqrt(2) - 2) * min(dx, dy)
```

Rules: 8 directions, grass 1, forest 3, rock and water blocked, no corner-cutting
(a diagonal step needs both orthogonal neighbours walkable). The open list is a
binary heap (O(log n) push/pop) with lazy deletion (duplicates are skipped when
popped).

**Code.** `findPath`, `octileDistance`, `canStep`, `stepCost`, `pathCost` in
[src/pathfinding/astar.js](../src/pathfinding/astar.js); `PriorityQueue` in
[src/pathfinding/priorityQueue.js](../src/pathfinding/priorityQueue.js).

## 5. Path smoothing

**Idea.** Grid paths zig-zag. Keep only the waypoints you cannot see past
("string pulling"). The line-of-sight check is *thick* (three parallel lines, the
unit's radius apart) and refuses shortcuts through terrain more expensive than both
endpoints, so smoothing never undoes A*'s decision to avoid a forest.

**Code.** `hasLineOfSight`, `smoothPath`, `tilePathToPixels` in
[src/pathfinding/smoothing.js](../src/pathfinding/smoothing.js). Overlay **1**.

## 6. Hierarchical pathfinding (HPA*)

**Idea.** Plan on a small abstract graph first, then fill in tile details only
when needed.

1. Split the map into 16 x 16 clusters (6 x 4 = 24).
2. Entrances: along each border between clusters, a run of open tile pairs is an
   opening. Short openings (< 6) get one entrance in the middle, long ones get two
   at the ends. Each entrance = 2 abstract nodes + an inter-cluster edge.
3. Intra-cluster edges: cluster-restricted A* between every pair of entrance nodes
   of a cluster; the cost and the tile path are cached.
4. Query: connect start and goal to their cluster's entrances (one Dijkstra flood
   each), run A* on the abstract graph, refine lazily one segment at a time.
5. Abstract routes are cached by (start cluster, goal cluster) for squads.
6. A shortcut pass after full refinement replaces entrance detours with cheaper
   straight octile lines.

**Why slightly suboptimal.** Routes must pass through fixed entrance tiles and are
optimal only inside each cluster. Measured: about 11% extra cost without the
shortcut pass, 2.5 to 5% with it.

**Code.** `buildAbstractGraph`, `hpaFindPath`, `refineNextSegment`, `refineFullPath`
in [src/pathfinding/hpa.js](../src/pathfinding/hpa.js); `shortcutTilePath` in
[src/pathfinding/smoothing.js](../src/pathfinding/smoothing.js); comparison in
[src/pathfinding/benchmark.js](../src/pathfinding/benchmark.js). Overlay **2**, AI Lab.

## 7. Time-aware planning at the bridges

**Idea.** Ordinary A* plans in space only. At the three bridges, units also plan
in *time* with a reservation table.

```
tEnter = now + (path cost to the bridge in tiles) * tileSize / speed - margin
tExit  = tEnter + crossing time (+ (squadSize - 1) * spacing / speed) + 2 * margin
overlap(a, b) <=> a.start < b.end AND b.start < a.end
wait   = earliest start with load + squadSize <= capacity, minus tEnter
choose the bridge with the smallest  travelTime + wait
```

The unit holds at the bridge entrance until its slot (yellow ring), and the
reservation is released when it has crossed, when its plan changed, or when it
died. **Honest note:** this is a simplified space-time planner applied only at
chokepoints; the full research version is **SIPP (Safe Interval Path Planning)**,
which plans over (cell, safe time interval) states everywhere.

**Code.** `intervalsOverlap`, `ReservationTable`, `chooseCrossing` in
[src/pathfinding/reservations.js](../src/pathfinding/reservations.js);
`planCrossingRoute` in [src/pathfinding/pathService.js](../src/pathfinding/pathService.js);
`updateBridgeCrossings` in [src/game/gameWorld.js](../src/game/gameWorld.js). Overlay **5**.

## 8. Local replanning

**Idea.** A unit that makes no progress towards its current waypoint for 1.5 s
(pushed behind a rock, blocked by a crowd) replans *only up to its next 2
waypoints* with a short A*, and splices the detour into its path. The rest of the
path is kept. Dynamic collision avoidance between units comes from separation steering.

**Code.** `updateLocalReplanning`, `replanLocally` in
[src/game/gameWorld.js](../src/game/gameWorld.js). Magenta ring in overlay **1**.

## 9. Performance for many NPCs

- **Spatial hash:** units go into 24 px buckets; a radius query visits only the
  cells under the circle. At 300 units: about 8,000 to 11,000 checks per step
  instead of about 90,000 (n^2). `SpatialHash` in
  [src/core/spatialHash.js](../src/core/spatialHash.js). Overlay **7**.
- **Time slicing:** path requests wait in a queue and only 4 are answered per
  simulation step. One pending request per unit and purpose; the Commander goes
  first. `PathService.update` in [src/pathfinding/pathService.js](../src/pathfinding/pathService.js).
- **Caching:** an LRU cache of A* results (`findTilePath`) and HPA*'s cluster-pair
  route cache.
- **Perception throttling:** brains look around every 0.2 s, staggered per unit
  (`updateThinkTimers` in [src/game/gameWorld.js](../src/game/gameWorld.js)).
- **Stress test:** key **T** adds 300 enemies (`spawnStressTest`). Measured about
  1 ms per simulation step for about 300 units.

## 10. Decision making with finite state machines

**Idea.** An NPC is always in exactly one state. Each state has `enter`, `update`
(returns an event or nothing) and `exit`. One explicit table maps
(state, event) -> next state; an event missing from the table throws.

Enemy: MARCH -> DECIDE (sees a defender) -> ATTACK / REPOSITION / RETREAT;
ATTACK -> RETREAT (HP < 30%); RETREAT (route home, evade, regenerate) -> REGROUP
(HP > 70%) -> MARCH; MARCH -> SIEGE (at the base). Allies: FOLLOW, ENGAGE, GUARD.

**Clear goals.** The enemy's goal chain is: attack the base -> fight defenders in
the way -> retreat when heavily damaged. MARCH checks them in that priority order.

**Behavior tree comparison** is written out in the header of
[src/ai/enemyBrain.js](../src/ai/enemyBrain.js), with why an FSM was chosen.

**Code.** `StateMachine` in [src/ai/fsm.js](../src/ai/fsm.js);
`createEnemyBrain`, `ENEMY_TRANSITIONS` in [src/ai/enemyBrain.js](../src/ai/enemyBrain.js);
`createAllyBrain`, `ALLY_TRANSITIONS` in [src/ai/allyBrain.js](../src/ai/allyBrain.js);
sensing in [src/ai/perception.js](../src/ai/perception.js). Overlay **4**.

## 11. Uncertainty

**Idea.** Weighted dice instead of fixed rules: ATTACK 70%, REPOSITION 20%,
RETREAT 10% on Normal. Lay the weights on a number line and roll a point:

```
roll = rng.next() * totalWeight
pick the option whose cumulative interval contains roll
```

All randomness uses one seeded LCG, so the same seed replays the same game:

```
state = (1664525 * state + 1013904223) mod 2^32,   value = state / 2^32
```

**Code.** `weightedChoice`, `chooseEngagementAction` in
[src/ai/decision.js](../src/ai/decision.js); `createRng` in [src/core/rng.js](../src/core/rng.js).

## 12. The complexity fallacy

**Idea.** Key **P** switches enemies to fixed rules: attack if the Commander's HP is
below 30%, retreat if their own HP is below 50%, otherwise always flank to the same
side. A player learns these after one sighting each and exploits them. Adding more
rules does not help: the behaviour is still a fixed lookup from situation to action,
just a longer one, with new gaps where rules interact. More complexity is not more
unpredictability; a little well-placed randomness is.

**Code.** `predictableAction` and the comment block above it in
[src/ai/decision.js](../src/ai/decision.js); How It Works screen in
[index.html](../index.html).

## 13. Difficulty scaling: smarter, not stronger

| | Easy | Normal | Hard |
|---|---|---|---|
| Reaction time (DECIDE pause) | 0.8 s | 0.5 s | 0.25 s |
| Squad coordination | none | shared targets | shared targets + pincer flanking |
| ATTACK / REPOSITION / RETREAT | 85 / 5 / 10 | 70 / 20 / 10 | 55 / 35 / 10 |
| Sight range | x 0.8 | x 1.0 | x 1.25 |

HP and damage are identical on every difficulty.

**Code.** `DIFFICULTIES`, `buildAiSettings` in [src/ai/difficulty.js](../src/ai/difficulty.js).
The enemy brain only calls `world.aiSettings`, so the FSM never changes.

## 14. Fixed-timestep game loop

```
accumulator += min(elapsedRealTime, 0.25)
while accumulator >= 1/60:  update(1/60); accumulator -= 1/60
render()
```

The simulation always sees the same dt, so movement is identical at any frame rate
and seeded runs are reproducible. `startLoop` in [src/core/loop.js](../src/core/loop.js).
