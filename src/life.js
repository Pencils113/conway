// Sparse, infinite Conway's Game of Life.
//
// Cells are stored as 32-bit packed keys: (x in upper 16 bits) | (y in lower 16 bits).
// This keeps the world coordinate range at +/- 32,768 in each axis (more than enough
// for interactive use) while letting us use a Set<number> and a Map<number,number>,
// which are dramatically faster than string-keyed structures for dense steps.
//
// The step routine iterates only the live cells and accumulates neighbor counts in a
// single Map, then applies B3/S23 — O(live cells * 9), independent of empty space.

const X_MASK = 0xFFFF;
const Y_MASK = 0xFFFF;
const SIGN = 0x8000;

export function pack(x, y) {
  // Two's-complement-ish packing: keep low 16 bits of each axis.
  return ((x & X_MASK) << 16) | (y & Y_MASK);
}
export function unpackX(k) {
  const x = (k >>> 16) & X_MASK;
  return x & SIGN ? x - 0x10000 : x;
}
export function unpackY(k) {
  const y = k & Y_MASK;
  return y & SIGN ? y - 0x10000 : y;
}

export class Life {
  constructor() {
    this.cells = new Set();    // live cell keys
    this.generation = 0;
    this._snapshot = null;     // for reset()
  }

  get population() { return this.cells.size; }

  has(x, y)        { return this.cells.has(pack(x, y)); }
  add(x, y)        { this.cells.add(pack(x, y)); }
  remove(x, y)     { this.cells.delete(pack(x, y)); }
  toggle(x, y) {
    const k = pack(x, y);
    if (this.cells.has(k)) this.cells.delete(k);
    else this.cells.add(k);
  }

  clear() {
    this.cells.clear();
    this.generation = 0;
    this._snapshot = null;
  }

  /**
   * Load a list of [x,y] coords, optionally offset. Records a snapshot for reset().
   */
  load(coords, ox = 0, oy = 0) {
    this.cells.clear();
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      this.cells.add(pack(c[0] + ox, c[1] + oy));
    }
    this.generation = 0;
    this._snapshot = new Set(this.cells);
  }

  snapshot() { this._snapshot = new Set(this.cells); }

  reset() {
    if (!this._snapshot) return false;
    this.cells = new Set(this._snapshot);
    this.generation = 0;
    return true;
  }

  /**
   * Advance one generation. B3/S23.
   */
  step() {
    const live = this.cells;
    const counts = new Map();

    // For each live cell, increment all 8 neighbors.
    for (const k of live) {
      const x = unpackX(k);
      const y = unpackY(k);

      // Manually unrolled — measurably faster than nested loops on V8.
      let nk;
      nk = pack(x - 1, y - 1); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x,     y - 1); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x + 1, y - 1); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x - 1, y    ); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x + 1, y    ); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x - 1, y + 1); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x,     y + 1); counts.set(nk, (counts.get(nk) || 0) + 1);
      nk = pack(x + 1, y + 1); counts.set(nk, (counts.get(nk) || 0) + 1);
    }

    const next = new Set();
    for (const [k, n] of counts) {
      if (n === 3 || (n === 2 && live.has(k))) next.add(k);
    }
    this.cells = next;
    this.generation++;
  }

  /**
   * Returns [minX, minY, maxX, maxY] of the live population, or null if empty.
   */
  bounds() {
    if (this.cells.size === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of this.cells) {
      const x = unpackX(k);
      const y = unpackY(k);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  }
}
