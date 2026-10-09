# Viva questions and model answers

40 likely questions, grouped by topic. Each answer is short and points at the code.

---

## Movement

**1. What is the difference between kinematic and steering movement?**
Kinematic movement sets the velocity directly (full speed, instant turns, no mass);
steering movement applies a force and integrates it: a = F/m, v += a·dt (clamped to
maxSpeed), p += v·dt. Compare `applyKinematicVelocity` and `applySteeringForce` in
`movement/agent.js`. Key K switches every unit live.

**2. Why does seek orbit the target, while arrive stops on it?**
Seek always wants full speed towards the target, so it overshoots and turns back
forever. Arrive scales the desired speed by distance / slowingRadius inside the
slowing radius, so the desired velocity reaches zero at the target (`arrive` in
`steering.js`).

**3. What does `force = (desired - velocity) / timeToTarget` mean?**
It is the acceleration needed to change the current velocity into the desired one
in `timeToTarget` seconds. A smaller timeToTarget means a stronger correction;
maxForce then caps it.

**4. How does pursue predict the target?**
T = distance / maxSpeed (the time to reach where the target is now), capped at
maxPredictionTime; predicted = targetPosition + targetVelocity·T; then seek that point
(`predictPosition`). Evade flees from the same predicted point.

**5. How does wander produce smooth random motion?**
A circle is projected ahead of the unit; a target point on its rim moves by a small
random angle each step (`binomial()`, which favours small changes), and the unit seeks
it. Because the target is always ahead and moves only a little, the path wiggles
instead of jerking (`wander`, `wanderCircle`).

**6. How does obstacle avoidance work?**
Three feeler rays (front and ±34°) grow with speed. `castFeeler` walks along each ray
until it enters a blocked tile; the wall normal comes from which tile boundary was
crossed. The push along the normal is scaled by closeness, by how directly the unit
moves into the wall (`headOn`) and by its speed ratio (`obstacleAvoidance`).

**7. Why did you add `headOn` and `speedRatio` to obstacle avoidance?**
Headless game runs showed frozen units. A unit walking along a wall kept touching it
with a side feeler, and a unit crawling sideways in a corridor got the full push.
Because avoidance has top priority, it ate the whole force budget and path following
got nothing. Pushing only in proportion to how fast and how directly you move into the
wall fixed it.

**8. How are several steering behaviors combined?**
A weighted, truncated running sum with priority (`combinePrioritized`): forces are
taken in priority order (avoidance, separation, evade, goal), each multiplied by its
weight, and added until the maxForce budget is used up. Separation is capped at half
the budget so a crowd cannot freeze a unit.

**9. Why inverse-square separation?**
force = strength / distance². Halving the distance gives four times the push, so units
strongly avoid overlapping but barely react to neighbours further away. A test checks
the 4x ratio (`tests/steering.test.js`).

**10. How do formations work?**
Each member has a slot offset in the leader's local frame (+x forward, +y right).
slot = leaderPosition + rotate(offset, leaderHeading); the member arrives at it.
Because the offset is rotated, the formation turns with the leader (`formations.js`,
`keepFormationSlot`). If the member is more than 60 px behind, it asks for an A* path
first (`keepSlotOrCatchUp`).

## A* and smoothing

**11. Explain f = g + h.**
g is the cheapest known cost from the start to the node, h is an estimate of the
remaining cost to the goal, f is the estimated total through that node. A* always
expands the open node with the lowest f (`findPath`).

**12. Why is the octile heuristic admissible?**
h = (dx + dy) + (√2 − 2)·min(dx, dy) is the exact cost on an empty grass grid with 8
directions. Every real tile costs at least 1, so the real cost can never be lower:
h never overestimates.

**13. Why do you stop when the goal is popped, not when it is first pushed?**
A cheaper route to the goal may still be found after it is first pushed. Only when it
is popped as the lowest-f node is its g guaranteed to be optimal (given an admissible,
consistent heuristic).

**14. What is lazy deletion in your A*?**
Instead of decreasing a node's priority inside the heap, a cheaper route pushes the
node again. The old, worse copy is skipped later because the node is already closed.
Simpler than decrease-key, same result.

**15. Why a binary heap?**
A* repeatedly needs the minimum f. Scanning a list is O(n) per pop; a heap gives
O(log n) push and pop (`priorityQueue.js`).

**16. What is corner-cutting and how do you prevent it?**
Moving diagonally between two blocked tiles that touch only at their corners. `canStep`
allows a diagonal step only if both orthogonal neighbours are walkable; a test checks
every diagonal step of a path.

**17. How do you know your A* is optimal?**
`tests/astar.test.js` compares its cost with a plain Dijkstra (no heuristic) on 40
random seeded grids with rocks and forest; they always match.

**18. How does path smoothing work, and why is the line of sight "thick"?**
Greedy string pulling: from an anchor, keep going while the next point is visible;
when it is not, keep the previous point as a waypoint. The check tests three parallel
lines a unit-radius apart, because a unit is not a point and a thin line would clip
rock corners. It also refuses to cross terrain costlier than both endpoints, so it never
undoes A*'s choice to avoid a forest (`hasLineOfSight`, `smoothPath`).

## HPA*

**19. Explain HPA* in four steps.**
(1) Split the map into 16×16 clusters. (2) Find entrances on cluster borders (one in
the middle of a short opening, two at the ends of a long one). (3) Precompute and cache
the paths between entrances inside each cluster. (4) At query time, connect start and
goal to their cluster's entrances, run A* on the small abstract graph, and refine
segments into tiles when needed (`hpa.js`).

**20. What is lazy refinement?**
The route is a list of abstract segments; `refineNextSegment` turns only the next one
into tiles, when the unit approaches the end of what it has (`extendRouteIfNeeded` in
`unitMovement.js`). Units that die or change plans never pay for the rest. With overlay
1 on you can see a leader's path grow piece by piece.

**21. Why are HPA* paths slightly suboptimal?**
They must pass through the fixed entrance tiles and are optimal only within each
cluster; joining optimal pieces is not globally optimal. Measured about 11% extra cost,
2.5 to 5% after the shortcut pass (`shortcutTilePath`). The test requires the average
to be within 10%.

**22. Your benchmark shows HPA* is not faster than A*. Why use it?**
The abstract search is about 15 times smaller (about 21 vs 336 nodes), but connecting
start and goal to the cluster entrances floods about 446 tiles, and on a 96×64 map A*
is already cheap. HPA* wins on bigger maps, and here squads share cached abstract
routes, so most leaders skip the abstract search entirely.

**23. Why do START and GOAL get temporary ids?**
So the precomputed graph is never modified; the next query sees it unchanged
(`searchAbstractGraph`).

## Time-aware planning and performance

**24. How does the bridge reservation system decide between waiting and another bridge?**
For each bridge: ETA = path cost × tileSize / speed; ask the table for the expected
wait in the window [ETA, ETA + crossing time]; total = travel time + wait. The bridge
with the smallest total wins. "Wait here" vs "detour" is just that comparison
(`planCrossingRoute`, `chooseCrossing`).

**25. When do two reservations overlap?**
[a.start, a.end) and [b.start, b.end) overlap if a.start < b.end and b.start < a.end
(`intervalsOverlap`, tested).

**26. When are reservations released?**
When the unit reaches the far end, when its order changes (new plan), or when it dies
(`updateBridgeCrossings`). Old ones also expire after 10 s as a safety net.

**27. Is this real space-time pathfinding?**
No, and the code says so: it is a simplified version applied only at the three
chokepoints, with estimated ETAs and safety margins. Elsewhere units plan in space
only and avoid each other reactively with separation. The full version is SIPP (Safe
Interval Path Planning), which runs A* over (cell, safe time interval) states.

**28. What is local replanning?**
If a unit makes no progress towards its current waypoint for 1.5 s, it runs a short A*
only to the waypoint after next and splices that detour into its path, keeping the
rest (`updateLocalReplanning`, `replanLocally`). Cheaper than replanning everything,
and the far part of the plan is usually still valid.

**29. What problem does the spatial hash solve?**
Neighbour queries. Brute force compares every unit with every other: n² (about 90,000
checks for 300 units). The hash puts units into 24 px cells and a query looks only at
the cells under its circle: about 8,000 to 11,000 checks. A test confirms it returns
exactly the brute-force answer.

**30. What is time slicing in the path service?**
Path requests wait in a queue and only 4 are answered per simulation step. When 50
squads ask at once, the work is spread over a few frames instead of freezing one.
Newer requests from the same unit replace older ones; the Commander's go first
(`PathService`).

## Decision making

**31. Draw the enemy FSM.**
MARCH →(ENEMY_SEEN) DECIDE →(CHOSE_ATTACK / CHOSE_REPOSITION / CHOSE_RETREAT)
ATTACK / REPOSITION / RETREAT; REPOSITION →(IN_POSITION) ATTACK; ATTACK, REPOSITION,
SIEGE, MARCH →(HP_LOW) RETREAT →(HP_RECOVERED) REGROUP →(REGROUPED) MARCH;
MARCH →(REACHED_BASE) SIEGE; DECIDE, ATTACK, REPOSITION →(TARGET_LOST) MARCH
(`ENEMY_TRANSITIONS`).

**32. Why an explicit transition table?**
The whole behaviour fits in one table that can be drawn and tested; an event with no
entry throws, so a missing transition is a loud bug, not a silent wrong state (`fsm.js`).

**33. How would the enemy look as a behavior tree, and why did you choose an FSM?**
A root selector: [HP < 30% → retreat], [at base → attack base], [defender visible →
wait → random selector (attack / flank → attack / retreat)], [march]. With 7 states
an FSM fits in one table, remembers what it is doing (e.g. retreating until 70% HP)
and gives a single state name to display. Behavior trees win for large, reusable
behaviours (the header of `enemyBrain.js`).

**34. What are the enemy's goals and how is the priority enforced?**
Attack the base → fight defenders in the way → retreat when heavily damaged. MARCH
checks the most urgent condition first each step: HP low (survive), then base reached
(main goal), then defenders seen (the obstacle in the way), otherwise keep marching.

**35. Why did allies need hysteresis?**
They chased an enemy to the leash limit, turned back, saw it again and chased again:
over 600 FOLLOW↔ENGAGE flips in 3 minutes. Now they only start a chase if the enemy is
within 75% of the leash (`isWorthChasing`), leaving a gap between "start" and "stop".

## Uncertainty, complexity fallacy, difficulty

**36. How does the weighted random choice work?**
Lay the weights end to end on a number line (attack [0, 0.7), reposition [0.7, 0.9),
retreat [0.9, 1.0)), roll a number in [0, total) and return the interval that contains
it (`weightedChoice`). A test checks the 70/20/10 frequencies over 20,000 rolls.

**37. If the AI is random, how are demos reproducible?**
All randomness comes from one seeded LCG owned by the game world:
state = (1664525·state + 1013904223) mod 2³². The same seed gives the same map and the
same rolls in the same order (`rng.js`, tested).

**38. What is the complexity fallacy, and how does your game show it?**
The belief that more rules make an AI smarter. Key P switches to fixed rules (attack
if the Commander < 30% HP, retreat if own HP < 50%, otherwise flank the same side).
After seeing each rule once a player can exploit them. More rules only make a longer
lookup table to learn, with new gaps where rules interact; a little randomness gives
varied behaviour with less logic (`predictableAction`).

**39. What does difficulty change, and what does it never change?**
Only reaction time (0.8 / 0.5 / 0.25 s), squad coordination (shared targets; pincer
flanking on Hard), how often enemies reposition, and sight range (×0.8 / 1 / 1.25). HP
and damage never change: "smarter, not stronger" (`difficulty.js`).

**40. How do you test AI behaviour that depends on a whole game?**
`GameWorld` is pure logic (no DOM), so tests create one headless, place units and step
it: e.g. an enemy below 30% HP must switch to RETREAT, and an enemy next to an ally must
go DECIDE → ATTACK only after its reaction time (`tests/fsm.test.js`). I also ran full
10-wave games headless to find bugs like the frozen units and the ally flip-flopping.
