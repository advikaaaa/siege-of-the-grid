/*
 * priorityQueue.test.js - tests for the binary heap (src/pathfinding/priorityQueue.js).
 * Course concept: the A* open list must always return the lowest-f node first.
 * Run with: npm test   (or: node --test tests/)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/pathfinding/priorityQueue.js';
import { createRng } from '../src/core/rng.js';

test('pops items in ascending priority order', () => {
  const queue = new PriorityQueue();
  queue.push('c', 3);
  queue.push('a', 1);
  queue.push('d', 4);
  queue.push('b', 2);
  assert.equal(queue.pop(), 'a');
  assert.equal(queue.pop(), 'b');
  assert.equal(queue.pop(), 'c');
  assert.equal(queue.pop(), 'd');
  assert.equal(queue.isEmpty(), true);
});

test('pop on an empty queue returns null', () => {
  assert.equal(new PriorityQueue().pop(), null);
});

test('handles duplicate priorities and many random values', () => {
  const rng = createRng(3);
  const queue = new PriorityQueue();
  const values = [];
  for (let i = 0; i < 500; i++) {
    const priority = rng.int(0, 50); // lots of duplicates
    values.push(priority);
    queue.push(priority, priority);
  }
  values.sort((a, b) => a - b);
  const popped = [];
  while (!queue.isEmpty()) {
    popped.push(queue.pop());
  }
  assert.deepEqual(popped, values);
});

test('interleaved push and pop keep the heap order', () => {
  const queue = new PriorityQueue();
  queue.push('x', 10);
  queue.push('y', 5);
  assert.equal(queue.pop(), 'y');
  queue.push('z', 1);
  queue.push('w', 7);
  assert.equal(queue.peekPriority(), 1);
  assert.equal(queue.pop(), 'z');
  assert.equal(queue.pop(), 'w');
  assert.equal(queue.pop(), 'x');
});
