/*
 * loop.js - the game loop: fixed-timestep updates + requestAnimationFrame rendering.
 * Course concept: real-time simulation. All movement formulas (position += velocity * dt,
 * velocity += acceleration * dt) assume a known, constant dt. A fixed step makes the
 * simulation behave identically on a 60 Hz laptop and a 144 Hz monitor, and makes
 * seeded runs reproducible.
 * Used by: main.js.
 *
 * How the accumulator works:
 *   Each screen frame we measure the real time elapsed since the last frame and add
 *   it to `accumulator`. Then, while the accumulator holds at least one step
 *   (1/60 s), we run one update and subtract one step. Leftover time (less than
 *   one step) carries over to the next frame.
 *
 *   Example: frames arrive every 25 ms, step = 16.67 ms
 *     frame 1: acc = 25    -> 1 update, acc = 8.33
 *     frame 2: acc = 33.33 -> 2 updates, acc = 0
 *   On average we still get exactly 60 updates per second.
 *
 * Rendering happens once per screen frame, after the updates. (Advanced engines
 * interpolate between the last two states using accumulator / step; we skip that
 * for readability, the difference is hard to see at 60 updates per second.)
 */

import { LOOP } from '../config.js';

// update(dt) is called with dt in SECONDS, always the same value.
// render() is called once per browser frame.
// stats is an object we write { fps } into so the HUD can show it.
export function startLoop(update, render, stats) {
  const stepSeconds = 1 / LOOP.updatesPerSecond;
  let accumulator = 0;
  let lastTimeMs = performance.now();

  // FPS counter: count rendered frames and publish the count once per second.
  let framesThisSecond = 0;
  let fpsTimerSeconds = 0;

  function frame(nowMs) {
    let elapsedSeconds = (nowMs - lastTimeMs) / 1000;
    lastTimeMs = nowMs;

    // Avoid the "spiral of death" after a long pause (see config.js).
    if (elapsedSeconds > LOOP.maxFrameSeconds) {
      elapsedSeconds = LOOP.maxFrameSeconds;
    }

    accumulator += elapsedSeconds;
    while (accumulator >= stepSeconds) {
      update(stepSeconds);
      accumulator -= stepSeconds;
    }

    render();

    framesThisSecond += 1;
    fpsTimerSeconds += elapsedSeconds;
    if (fpsTimerSeconds >= 1) {
      stats.fps = Math.round(framesThisSecond / fpsTimerSeconds);
      framesThisSecond = 0;
      fpsTimerSeconds = 0;
    }

    // Ask the browser to call us again before the next repaint (~60 times/s).
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
