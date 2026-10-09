/*
 * config.js - every tunable number in the game, in one place.
 * Course concept: supports all of them. Keeping numbers here (instead of scattered
 * through the code) lets us tune behaviour and explain it without hunting for
 * "magic numbers". Later phases add steering weights, unit stats and waves here.
 * Used by: almost every file (main.js, core/loop.js, world/mapGen.js, render/*, scenes/*).
 */

// ---- Map size -------------------------------------------------------------
// 96 x 64 tiles of 12 px = a 1152 x 768 canvas.
// 96 and 64 are both multiples of 16, so the map splits cleanly into
// 16 x 16 HPA* clusters later: 96/16 = 6 columns, 64/16 = 4 rows = 24 clusters.
export const MAP = {
  widthTiles: 96,
  heightTiles: 64,
  tileSize: 12,
};

// ---- Game loop ------------------------------------------------------------
export const LOOP = {
  // Fixed timestep: the simulation always advances in steps of 1/60 s,
  // no matter how fast or slow the screen refreshes.
  updatesPerSecond: 60,
  // If the tab was hidden or the computer stalled, we would owe the simulation
  // hundreds of steps. We cap the catch-up at 0.25 s to avoid the
  // "spiral of death" (falling further behind because catching up is slow).
  maxFrameSeconds: 0.25,
};

// Seed used when the URL has no ?seed= parameter. The same seed always produces
// the same map and the same AI dice rolls, so demos are reproducible.
export const DEFAULT_SEED = 12345;

// ---- Player base (in tiles) -----------------------------------------------
// A rectangle on the left edge, vertically centred.
export const BASE = {
  x: 2,
  y: 29,
  width: 4,
  height: 6,
};

// ---- Agents (all distances in PIXELS, times in SECONDS) ----------------------
// 1 tile = 12 px, so maxSpeed 70 px/s is just under 6 tiles per second.
export const AGENT = {
  maxSpeed: 70,
  maxForce: 200,   // with mass 1 this is also the max acceleration (px/s^2)
  mass: 1,
  radius: 4,
};

// ---- Steering behaviors ------------------------------------------------------
export const STEERING = {
  // Every "desired velocity" behavior returns force = (desired - current) / timeToTarget.
  // A smaller timeToTarget means "I want to reach the desired velocity faster",
  // i.e. a bigger force. maxForce then caps it.
  timeToTarget: 0.1,

  slowingRadius: 48,         // arrive: start slowing down this far (px) from the target
  maxPredictionTime: 1.5,    // pursue/evade: never look further ahead than this (s)
  panicRadius: 120,          // flee/evade: only run when the threat is closer than this

  // wander: a circle projected wanderDistance ahead; we seek a point on its rim
  wanderDistance: 30,
  wanderRadius: 14,
  wanderJitter: 8,           // how fast the point moves around the rim (rad/s)
  kinematicMaxRotation: 4,   // kinematic wander: max turn rate (rad/s)

  // obstacle avoidance: 3 feeler rays (front, front-left, front-right)
  feelerMinLength: 10,       // feeler length when standing still (px)
  feelerLength: 28,          // extra length at full speed (px)
  sideFeelerAngle: 0.6,      // angle of side feelers from the heading (rad, ~34 deg)
  sideFeelerScale: 0.7,      // side feelers are 70% as long as the front one
  feelerSampleStep: 3,       // check the ray every 3 px for a blocked tile
  avoidanceForce: 400,       // push when the obstacle is right at the agent

  // separation: inverse-square push away from close neighbours
  separationRadius: 18,
  separationStrength: 12000, // force = strength / distance^2  (at 8 px: 187)

  // path following: a waypoint counts as reached within this distance (px)
  waypointRadius: 8,
  // the whole path counts as finished within this distance of the last point (px)
  arrivalTolerance: 3,

  // Blending weights. Order matters too: see combinePrioritized() in steering.js.
  weights: {
    obstacleAvoidance: 2.0,
    separation: 1.5,
    seek: 1,
    flee: 1,
    arrive: 1,
    pursue: 1,
    evade: 1,
    wander: 1,
    followPath: 1,
    formation: 1,
  },
};

// Where the Commander and the allies appear, relative to the base (tiles).
export const PLAYER_SPAWN_OFFSET_X = 2;

// ---- Hierarchical pathfinding (HPA*) ---------------------------------------------
export const HPA = {
  // 16 x 16 tile clusters: 96 / 16 = 6 columns, 64 / 16 = 4 rows = 24 clusters.
  clusterSize: 16,
  // An opening on a cluster border shorter than this gets ONE entrance in its
  // middle; a longer opening gets TWO entrances, one at each end.
  longEntranceLength: 6,
  // After full refinement, look this many tiles ahead for cheaper straight
  // shortcuts (see shortcutTilePath in smoothing.js).
  shortcutLookahead: 24,
};

// ---- Units and combat (distances in px, times in s) ---------------------------------
// attackRange is the reach BEYOND touching: a hit lands when
//   distance(centres) <= attacker.radius + target.radius + attackRange
// HP and damage never change with difficulty: "smarter, not stronger".
export const UNIT_STATS = {
  commander: { maxHp: 400, damage: 25, attackRange: 8, attackCooldown: 0.5, sightRange: 96, maxSpeed: 75, radius: 5 },
  ally: { maxHp: 140, damage: 10, attackRange: 8, attackCooldown: 0.8, sightRange: 84, maxSpeed: 68, radius: 4 },
  enemy: { maxHp: 80, damage: 5, attackRange: 8, attackCooldown: 0.9, sightRange: 84, maxSpeed: 52, radius: 4 },
};

export const COMBAT = {
  baseMaxHp: 2000,
  commanderRespawnSeconds: 5,
  retreatBelowHpFraction: 0.3,   // ATTACK -> RETREAT when HP < 30%
  regroupAboveHpFraction: 0.7,   // RETREAT -> REGROUP when HP > 70%
  retreatRegenPerSecond: 10,     // HP regained per second while retreating
  siegeDistance: 24,             // an enemy this close to the base starts the siege
};

// ---- AI decision making ----------------------------------------------------------
export const AI = {
  // Brains look around (perception) only every thinkInterval seconds, not every
  // 1/60 s step: line-of-sight checks are the expensive part, and real players
  // do not react within 16 ms either.
  thinkInterval: 0.2,
  // Delay between seeing a target and acting on it (DECIDE state).
  // P7 makes this depend on the difficulty.
  reactionTime: 0.5,
  // Uncertain decisions: weighted random choice when an enemy sees a target.
  decisionWeights: { ATTACK: 0.7, REPOSITION: 0.2, RETREAT: 0.1 },
  flankDistance: 48,          // REPOSITION: how far to the side of the target to go
  flankTimeout: 3,            // give up flanking after this long and just attack
  loseTargetDistance: 140,    // a chased target further than this is "lost"
  catchUpDistance: 60,        // a formation member further than this from its slot paths to it
  catchUpReplanSeconds: 1.5,  // how often a catching-up unit asks for a new path
  allyLeashDistance: 160,     // allies stop chasing this far from the Commander
  engageWithinLeashFraction: 0.75, // ...and only start chasing enemies within 75% of it
  guardRadius: 120,           // guarding allies engage enemies this close to the guard point
  regroupDistance: 36,        // REGROUP is done this close to the squad leader
  regroupTimeout: 8,
  minRetreatSeconds: 3,       // a retreat lasts at least this long, even at high HP
};

// ---- Formations -------------------------------------------------------------------
export const FORMATION = {
  spacing: 16,            // px between neighbouring slots
  enemySquadShape: 'V',
};

// ---- Waves --------------------------------------------------------------------------
// Wave n has firstWaveSize + (n - 1) * sizeIncrease enemies: 4, 6, 8, ... 22.
export const WAVES = {
  total: 10,
  firstWaveSize: 4,
  sizeIncrease: 2,
  maxSquadSize: 6,
  firstWaveDelay: 5,
  delayBetweenWaves: 10,  // after a wave is cleared
  delayBetweenSquads: 2.5,
  maxWaveSeconds: 120,    // start the next wave anyway after this long
};

// ---- AI Lab --------------------------------------------------------------------
export const LAB = {
  agentCount: 6,
  targetOrbitRadius: 180,    // pursue/evade target dot moves on this circle (px)
  targetOrbitSpeed: 0.7,     // angular speed of the target dot (rad/s)
  benchmarkQueries: 200,     // random start/goal pairs in the A* vs HPA* benchmark
};

// ---- Map generation ---------------------------------------------------------
export const MAPGEN = {
  // The river: 3 tiles wide, centred near the middle column, drifting left and
  // right a little so it looks natural.
  riverWidth: 3,
  riverCenterX: 48,
  riverMaxDrift: 4,          // how far (tiles) the river may wander from the centre
  riverShiftChance: 0.3,     // chance per row that the river shifts by 1 tile

  // Exactly 3 bridges, each 2 tiles tall, roughly at 1/4, 2/4 and 3/4 of the height.
  bridgeCount: 3,
  bridgeHeight: 2,
  bridgeJitter: 3,           // random vertical offset (+/- tiles) for each bridge
  bridgeClearance: 3,        // keep this many tiles around bridge ends free of rocks/forest

  // Areas kept free of obstacles so the base and the enemy spawn are reachable.
  baseClearWidth: 12,        // columns 0..11 on the left
  spawnClearWidth: 6,        // last 6 columns on the right

  // Obstacles are grown as "blobs" with a random walk (see mapGen.js).
  rockBlobCount: 45,
  rockBlobSteps: { min: 8, max: 25 },
  forestBlobCount: 35,
  forestBlobSteps: { min: 20, max: 50 },

  // If a generated map is not fully connected we throw it away and try again.
  // Measured over 200 seeds: about 6 attempts on average, 42 at worst, ~4 ms each.
  maxAttempts: 300,
};
