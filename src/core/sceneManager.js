/*
 * sceneManager.js - switches between screens (scenes).
 * Course concept: none directly; it organises the program so each screen
 * (Menu, Game, AI Lab, How It Works, Win/Lose) is its own small object.
 * Used by: main.js.
 *
 * A scene is any object with these methods:
 *   enter(params)  - called when the scene becomes active
 *   exit()         - called when we leave it
 *   update(dt)     - called every fixed step (dt in seconds)
 *   render(ctx)    - called every browser frame
 */

export class SceneManager {
  constructor() {
    this.scenes = new Map();
    this.currentScene = null;
    this.currentName = '';
  }

  register(name, scene) {
    this.scenes.set(name, scene);
  }

  switchTo(name, params = {}) {
    if (!this.scenes.has(name)) {
      throw new Error('Unknown scene: ' + name);
    }
    if (this.currentScene !== null) {
      this.currentScene.exit();
    }
    this.currentScene = this.scenes.get(name);
    this.currentName = name;
    this.currentScene.enter(params);
  }

  update(dt) {
    if (this.currentScene !== null) {
      this.currentScene.update(dt);
    }
  }

  render(ctx) {
    if (this.currentScene !== null) {
      this.currentScene.render(ctx);
    }
  }
}
