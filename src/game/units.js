/*
 * units.js - creates the game's units (a unit = an Agent body + game data).
 * Course concept: NPC movement in the game. Each unit owns an Agent (physics,
 * movement) and a path follower (path-following memory). Combat, HP and AI
 * brains are added in P5.
 * Used by: scenes/gameScene.js.
 */

import { Agent } from '../movement/agent.js';

// The player's Commander: moves where the player clicks (A* + smoothing + path following).
export function createCommander(position) {
  return {
    kind: 'commander',
    color: '#3a86ff',
    agent: new Agent({ position: position, radius: 5 }),
    follower: null,      // path-following memory, see movement/pathMovement.js
    rawPath: null,       // tile path straight from A* (overlay 1, orange)
    smoothedPath: null,  // tile path after smoothing (overlay 1, cyan)
  };
}
