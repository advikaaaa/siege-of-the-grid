/*
 * spatialHash.js - a uniform grid of buckets for fast "who is near me?" queries.
 * Course concept: PERFORMANCE FOR MANY NPCs. Separation and sight need each
 * unit's neighbours. Checking every unit against every other unit costs n^2:
 * 300 units -> 90,000 checks per step. A spatial hash only checks the units in
 * the few cells around you, so the cost grows roughly with n instead of n^2.
 * Used by: game/gameWorld.js (separation, sight, Commander auto-attack),
 * render/overlays.js (overlay 7), tests/spatialHash.test.js.
 *
 * Pure logic: no DOM or canvas.
 *
 * How it works:
 *   - The world is divided into square cells of cellSize px.
 *   - cell of a point = (floor(x / cellSize), floor(y / cellSize))
 *   - Every step we clear the hash and insert every unit into its cell's bucket
 *     (units move, so rebuilding is simpler than updating).
 *   - A radius query visits only the cells overlapping the circle's bounding box
 *     and returns the items within the radius.
 */

export class SpatialHash {
  constructor(cellSize, worldWidth, worldHeight) {
    this.cellSize = cellSize;
    this.columns = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
    this.buckets = new Map(); // cell key -> array of { item, position }
    this.checksThisStep = 0;  // distance checks done by queries (shown in the HUD)
  }

  // A cell (column, row) as one number. Positions slightly outside the map are
  // clamped to the edge cells.
  cellKey(column, row) {
    const c = Math.max(0, Math.min(this.columns - 1, column));
    const r = Math.max(0, Math.min(this.rows - 1, row));
    return r * this.columns + c;
  }

  clear() {
    this.buckets.clear();
    this.checksThisStep = 0;
  }

  insert(item, position) {
    const key = this.cellKey(Math.floor(position.x / this.cellSize), Math.floor(position.y / this.cellSize));
    if (!this.buckets.has(key)) {
      this.buckets.set(key, []);
    }
    this.buckets.get(key).push({ item: item, position: position });
  }

  // All items whose position is within `radius` of `centre`.
  queryRadius(centre, radius) {
    const result = [];
    const firstColumn = Math.floor((centre.x - radius) / this.cellSize);
    const lastColumn = Math.floor((centre.x + radius) / this.cellSize);
    const firstRow = Math.floor((centre.y - radius) / this.cellSize);
    const lastRow = Math.floor((centre.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    const visited = new Set(); // clamping can map two cells to the same edge cell

    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const key = this.cellKey(column, row);
        if (visited.has(key) || !this.buckets.has(key)) {
          continue;
        }
        visited.add(key);
        for (const entry of this.buckets.get(key)) {
          this.checksThisStep += 1;
          const dx = entry.position.x - centre.x;
          const dy = entry.position.y - centre.y;
          if (dx * dx + dy * dy <= radiusSquared) {
            result.push(entry.item);
          }
        }
      }
    }
    return result;
  }

  // For overlay 7: [{ column, row, count }] of every non-empty cell.
  occupiedCells() {
    const cells = [];
    for (const [key, entries] of this.buckets) {
      cells.push({ column: key % this.columns, row: Math.floor(key / this.columns), count: entries.length });
    }
    return cells;
  }
}
