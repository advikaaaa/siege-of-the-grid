/*
 * reservations.js - time-aware planning at the 3 bridges (a reservation table).
 * Course concept: CONTINUOUS-TIME / TIME-AWARE PATHFINDING. Ordinary A* plans in
 * SPACE only: it does not know that 40 units will reach the same bridge at the
 * same moment. Here a unit also plans in TIME at the chokepoints:
 *   1. ETA:     tEnter = now + (path cost to the bridge in tiles * tileSize) / speed
 *               tExit  = tEnter + crossing time
 *   2. Check:   how many units have reservations overlapping [tEnter, tExit]?
 *               If that reaches the bridge capacity, find the earliest start time
 *               with room: expected wait = tStart - tEnter.
 *   3. Choose:  for every bridge: total = travel time + expected wait.
 *               "Wait at the busy bridge" vs "walk to another bridge" is simply the
 *               bridge with the smallest total.
 *   4. Reserve: [tStart, tStart + crossing time] on the chosen bridge, and release it
 *               when the crossing is done, the plan changes, or the unit dies.
 * Used by: game/gameWorld.js, pathfinding/pathService.js,
 * tests/reservations.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * ---------------------------------------------------------------------------
 * HONEST NOTE - what this is and what it is not:
 * This is a SIMPLIFIED form of space-time planning, applied ONLY at the three
 * chokepoints. Everywhere else units still plan in space only, and collisions
 * between them are avoided reactively by separation steering. ETAs are
 * estimates (steering units do not move at exactly maxSpeed, and forest cost is
 * counted as distance), which is why every reservation gets a safety margin.
 * The full research version plans in space AND time for every cell: SIPP (Safe
 * Interval Path Planning, Phillips & Likhachev 2011) stores, per cell, the
 * "safe intervals" when it is free, and runs A* over (cell, interval) states, so
 * a unit can plan to wait anywhere, not just at a bridge. That gives
 * collision-free plans but costs much more per search than our approach.
 * ---------------------------------------------------------------------------
 */

// Do the time intervals [aStart, aEnd) and [bStart, bEnd) overlap?
// They overlap unless one ends before the other starts:
//   overlap  <=>  aStart < bEnd  AND  bStart < aEnd
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export class ReservationTable {
  // bridgeIds: e.g. [0, 1, 2]; capacity: units allowed on a bridge at once.
  constructor(bridgeIds, capacity) {
    this.capacity = capacity;
    this.byBridge = new Map();
    for (const id of bridgeIds) {
      this.byBridge.set(id, []);
    }
    this.nextId = 1;
  }

  // size = how many units the reservation stands for (a squad crossing together).
  reserve(bridgeId, ownerId, start, end, size) {
    const reservation = { id: this.nextId, bridgeId: bridgeId, ownerId: ownerId, start: start, end: end, size: size };
    this.nextId += 1;
    this.byBridge.get(bridgeId).push(reservation);
    return reservation;
  }

  release(reservation) {
    const list = this.byBridge.get(reservation.bridgeId);
    const index = list.indexOf(reservation);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  // Total size of the reservations overlapping [start, end) on a bridge.
  // (Conservative: it counts everyone overlapping the window, even if they are
  // never all on the bridge at the same instant.)
  loadDuring(bridgeId, start, end) {
    let load = 0;
    for (const reservation of this.byBridge.get(bridgeId)) {
      if (intervalsOverlap(start, end, reservation.start, reservation.end)) {
        load += reservation.size;
      }
    }
    return load;
  }

  // Earliest start time >= desiredStart at which a group of `size` fits for
  // `duration` seconds. Only two kinds of moments can be the answer: the desired
  // start itself, or the moment some existing reservation ends (that is when
  // room frees up). We try those in time order.
  earliestStart(bridgeId, desiredStart, duration, size) {
    const candidates = [desiredStart];
    for (const reservation of this.byBridge.get(bridgeId)) {
      if (reservation.end > desiredStart) {
        candidates.push(reservation.end);
      }
    }
    candidates.sort((a, b) => a - b);
    for (const start of candidates) {
      const room = this.capacity - this.loadDuring(bridgeId, start, start + duration);
      if (room >= size) {
        return start;
      }
    }
    // Bigger than the capacity on its own: go after everyone else.
    return candidates[candidates.length - 1];
  }

  expectedWait(bridgeId, desiredStart, duration, size) {
    return this.earliestStart(bridgeId, desiredStart, duration, size) - desiredStart;
  }

  // Forget reservations that ended long ago (a unit that never released, e.g.
  // because it was pushed back, must not block the bridge forever).
  expire(now, keepSeconds) {
    for (const [bridgeId, list] of this.byBridge) {
      this.byBridge.set(bridgeId, list.filter((reservation) => reservation.end > now - keepSeconds));
    }
  }

  reservationsFor(bridgeId) {
    return this.byBridge.get(bridgeId);
  }
}

// Pick the bridge with the smallest total time.
// options: [{ bridgeId, travelTime, wait }] (bridges that cannot be reached are left out)
// Returns the chosen option plus `preferred` (shortest travel, ignoring waits), so
// the HUD can say "B2 is busy, B1 is quicker" when they differ.
export function chooseCrossing(options) {
  let best = null;
  let preferred = null;
  for (const option of options) {
    const total = option.travelTime + option.wait;
    if (best === null || total < best.travelTime + best.wait) {
      best = option;
    }
    if (preferred === null || option.travelTime < preferred.travelTime) {
      preferred = option;
    }
  }
  return { chosen: best, preferred: preferred };
}
