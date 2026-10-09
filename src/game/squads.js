/*
 * squads.js - enemy squads: one leader plus members holding formation slots.
 * Course concept: FORMATIONS + HIERARCHICAL movement. Only the LEADER plans a
 * route (HPA*, shared through the route cache); members just keep their slot
 * behind the leader with steering. One path search per squad instead of one per
 * unit is a big saving when many NPCs move.
 * Used by: game/gameWorld.js, ai/enemyBrain.js.
 *
 * Pure logic: no DOM or canvas.
 */

import { FORMATION } from '../config.js';
import { formationOffsets } from '../movement/formations.js';

export function createSquad(id, members) {
  const squad = { id: id, members: members, leader: members[0] };
  for (const member of members) {
    member.squad = squad;
  }
  return squad;
}

export function isLeader(unit) {
  return unit.squad !== null && unit.squad.leader === unit;
}

// If the leader died, the first living member takes over (it will plan its own
// route as soon as it is marching). Dead members are dropped from the list.
export function updateSquad(squad) {
  squad.members = squad.members.filter((member) => member.alive);
  if (!squad.leader.alive && squad.members.length > 0) {
    squad.leader = squad.members[0];
  }
}

// The formation anchor is the CURRENT leader's pose (a function, so it stays
// right even after a new leader is promoted).
export function squadAnchor(squad) {
  return function getAnchor() {
    return { position: squad.leader.agent.position, heading: squad.leader.agent.heading };
  };
}

// Slot offset for a member: members (without the leader) are numbered in list
// order, and number i takes slot i of the squad's formation shape.
export function memberSlotOffset(unit) {
  const squad = unit.squad;
  const followers = squad.members.filter((member) => member !== squad.leader);
  const offsets = formationOffsets(FORMATION.enemySquadShape, followers.length, FORMATION.spacing);
  return offsets[followers.indexOf(unit)];
}
