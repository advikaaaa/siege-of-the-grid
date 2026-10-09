/*
 * waves.js - enemy waves of growing size.
 * Course concept: drives the scenario. Wave n has
 *     firstWaveSize + (n - 1) * sizeIncrease   enemies (4, 6, 8, ... 22)
 * split into squads of at most maxSquadSize, spawned a few seconds apart from
 * the right edge. Surviving all 10 waves wins the game.
 * Used by: game/gameWorld.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * States: 'waiting' (countdown to the next wave) -> 'spawning' (squads appear)
 *         -> 'fighting' (until the wave is cleared or times out) -> 'waiting' ...
 *         After the last wave is cleared: 'done'.
 */

import { WAVES } from '../config.js';

function waveSize(waveNumber) {
  return WAVES.firstWaveSize + (waveNumber - 1) * WAVES.sizeIncrease;
}

// 22 -> [6, 6, 6, 4]
function splitIntoSquads(enemyCount) {
  const sizes = [];
  let remaining = enemyCount;
  while (remaining > 0) {
    const size = Math.min(WAVES.maxSquadSize, remaining);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

export class WaveManager {
  constructor() {
    this.waveNumber = 0;
    this.state = 'waiting';
    this.timer = WAVES.firstWaveDelay;
    this.squadsToSpawn = [];
    this.waveElapsed = 0;
  }

  isComplete() {
    return this.state === 'done';
  }

  // world must provide spawnSquad(size) and enemyCount().
  update(dt, world) {
    if (this.state === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.startNextWave();
      }
      return;
    }

    this.waveElapsed += dt;
    if (this.state === 'spawning') {
      this.timer -= dt;
      if (this.timer <= 0) {
        world.spawnSquad(this.squadsToSpawn.shift());
        this.timer = WAVES.delayBetweenSquads;
        if (this.squadsToSpawn.length === 0) {
          this.state = 'fighting';
        }
      }
      return;
    }

    // 'fighting'
    const cleared = world.enemyCount() === 0;
    const isLastWave = this.waveNumber === WAVES.total;
    if (cleared && isLastWave) {
      this.state = 'done';
    } else if (cleared || (!isLastWave && this.waveElapsed > WAVES.maxWaveSeconds)) {
      this.state = 'waiting';
      this.timer = WAVES.delayBetweenWaves;
    }
  }

  startNextWave() {
    this.waveNumber += 1;
    this.squadsToSpawn = splitIntoSquads(waveSize(this.waveNumber));
    this.state = 'spawning';
    this.timer = 0; // first squad right away
    this.waveElapsed = 0;
  }
}
