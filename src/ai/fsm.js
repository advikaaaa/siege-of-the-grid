/*
 * fsm.js - a generic finite state machine (FSM) with an explicit transition table.
 * Course concept: DECISION MAKING with FSMs. An NPC is always in exactly one
 * state (MARCH, ATTACK, ...). Each state has:
 *   enter(fsm)       - runs once when we arrive in the state (set up movement, timers)
 *   update(dt, fsm)  - runs every step; returns an EVENT name (e.g. 'HP_LOW') or null
 *   exit(fsm)        - runs once when we leave (clean up)
 * The TRANSITION TABLE says, for each state, which event leads to which state:
 *   { ATTACK: { HP_LOW: 'RETREAT', TARGET_LOST: 'MARCH' }, ... }
 * Used by: ai/allyBrain.js, ai/enemyBrain.js, tests/fsm.test.js.
 *
 * WHY an explicit table instead of "if (...) state = 'RETREAT'" scattered in code:
 * the whole behaviour fits on one screen, you can draw it as a diagram, and an
 * event that is not in the table is a BUG we report loudly (throw) instead of
 * silently ending up in a strange state.
 *
 * Pure logic: no DOM or canvas.
 */

export class StateMachine {
  // definition = { initial, states: { NAME: { enter?, update?, exit? } }, transitions }
  constructor(name, definition) {
    this.name = name;
    this.states = definition.states;
    this.transitions = definition.transitions;
    this.current = definition.initial;
    this.previous = null;
    this.timeInState = 0;
    this.started = false;
  }

  // Enter the initial state. Separate from the constructor so the owner can
  // finish setting itself up first.
  start() {
    this.started = true;
    this.callHook('enter');
  }

  update(dt) {
    if (!this.started) {
      this.start();
    }
    this.timeInState += dt;
    const state = this.states[this.current];
    if (state.update === undefined) {
      return;
    }
    const event = state.update(dt, this);
    if (event !== null && event !== undefined) {
      this.send(event);
    }
  }

  // Look the event up in the table and change state.
  send(event) {
    const row = this.transitions[this.current];
    const next = row !== undefined ? row[event] : undefined;
    if (next === undefined) {
      throw new Error(this.name + ': no transition from ' + this.current + ' on event ' + event);
    }
    this.changeState(next);
  }

  // True if `event` is allowed in the current state.
  canHandle(event) {
    const row = this.transitions[this.current];
    return row !== undefined && row[event] !== undefined;
  }

  changeState(next) {
    this.callHook('exit');
    this.previous = this.current;
    this.current = next;
    this.timeInState = 0;
    this.callHook('enter');
  }

  callHook(hookName) {
    const state = this.states[this.current];
    if (state[hookName] !== undefined) {
      state[hookName](this);
    }
  }
}
