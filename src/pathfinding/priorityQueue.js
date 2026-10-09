/*
 * priorityQueue.js - a min-priority queue implemented as a binary heap.
 * Course concept: the OPEN LIST of A*. A* must repeatedly take out the node with
 * the lowest f = g + h. Scanning an array for the minimum costs O(n) each time;
 * a binary heap does push and pop in O(log n), which is what makes A* fast on
 * thousands of tiles.
 * Used by: pathfinding/astar.js (and hpa.js, which reuses astar-style search, in P4).
 *
 * Pure logic: no DOM or canvas.
 *
 * How a binary heap works:
 *   - It is a complete binary tree stored in an array, level by level:
 *         index 0 is the root, children of i are 2i + 1 and 2i + 2,
 *         parent of i is floor((i - 1) / 2).
 *   - Heap rule: every parent's priority <= its children's priorities,
 *     so the smallest priority is always at index 0.
 *   - push: append at the end, then "sift up" (swap with the parent while smaller).
 *   - pop:  take the root, move the last element to the root, then "sift down"
 *           (swap with the smaller child while bigger).
 *   Both walk one root-to-leaf path, i.e. O(log n) steps.
 */

export class PriorityQueue {
  constructor() {
    // Each entry is { item, priority }.
    this.heap = [];
  }

  get size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  push(item, priority) {
    this.heap.push({ item: item, priority: priority });
    this.siftUp(this.heap.length - 1);
  }

  // Removes and returns the item with the LOWEST priority (null if empty).
  pop() {
    if (this.heap.length === 0) {
      return null;
    }
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top.item;
  }

  // The lowest priority currently stored, without removing it.
  peekPriority() {
    if (this.heap.length === 0) {
      return Infinity;
    }
    return this.heap[0].priority;
  }

  siftUp(index) {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.heap[child].priority >= this.heap[parent].priority) {
        break; // heap rule holds, done
      }
      this.swap(child, parent);
      child = parent;
    }
  }

  siftDown(index) {
    let parent = index;
    const count = this.heap.length;
    while (true) {
      const left = 2 * parent + 1;
      const right = 2 * parent + 2;
      let smallest = parent;
      if (left < count && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < count && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === parent) {
        break; // both children are bigger, done
      }
      this.swap(parent, smallest);
      parent = smallest;
    }
  }

  swap(i, j) {
    const temporary = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temporary;
  }
}
