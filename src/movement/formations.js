/*
 * formations.js - slot offsets for the formation shapes.
 * Course concept: FORMATION movement. Each member gets a fixed SLOT, written as an
 * offset in the leader's local frame (+x = in front of the leader, +y = to the
 * leader's right). steering.js rotates the offset by the leader's heading and the
 * member "arrives" at it (keepFormationSlot). Because the offsets are local, the
 * whole formation turns when the leader turns.
 * Used by: game/gameWorld.js, game/squads.js, tests/fsm.test.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { vec } from '../core/vector.js';

export const FORMATION_NAMES = ['LINE', 'V', 'BOX'];

// Returns `count` offsets for the named shape.
export function formationOffsets(name, count, spacing) {
  switch (name) {
    case 'LINE':
      return lineOffsets(count, spacing);
    case 'V':
      return wedgeOffsets(count, spacing);
    case 'BOX':
      return boxOffsets(count, spacing);
    default:
      throw new Error('Unknown formation: ' + name);
  }
}

// One row, side by side, one spacing behind the leader, centred:
//   y = (i - (count - 1) / 2) * spacing
function lineOffsets(count, spacing) {
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push(vec(-spacing, (i - (count - 1) / 2) * spacing));
  }
  return offsets;
}

// A "V" opening backwards: members alternate left/right, each pair one rank further back.
//   rank = floor(i / 2) + 1,  x = -rank * spacing,  y = +-rank * spacing
function wedgeOffsets(count, spacing) {
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const rank = Math.floor(i / 2) + 1;
    const side = i % 2 === 0 ? -1 : 1;
    offsets.push(vec(-rank * spacing, side * rank * spacing));
  }
  return offsets;
}

// A square ring around the leader (the leader in the middle, protected).
// Ring 1 is the 8 cells around the centre of a 3x3 square, ring 2 the 16 cells
// around a 5x5 square, and so on, until every member has a slot.
function boxOffsets(count, spacing) {
  const offsets = [];
  let ring = 1;
  while (offsets.length < count) {
    for (const cell of ringCells(ring)) {
      if (offsets.length < count) {
        offsets.push(vec(cell.x * spacing, cell.y * spacing));
      }
    }
    ring += 1;
  }
  return offsets;
}

// Cells on the border of the (2r+1) x (2r+1) square centred on (0, 0).
function ringCells(ring) {
  const cells = [];
  for (let y = -ring; y <= ring; y++) {
    for (let x = -ring; x <= ring; x++) {
      const onBorder = Math.abs(x) === ring || Math.abs(y) === ring;
      if (onBorder) {
        cells.push({ x: x, y: y });
      }
    }
  }
  return cells;
}
