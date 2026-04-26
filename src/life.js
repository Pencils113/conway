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
    // Bounded ring buffer of past generations (for step-back). Each entry is
    // an Array<int> of cell keys — cheaper to store than Set, and rebuilding a
    // Set from an array is fast.
    this.historyMax = 256;
    this._history = [];
    // Default rule: Conway's B3/S23. Bitmasks: bit n means "applies with n
    // live neighbors".
    this.rule = { birth: 1 << 3, survive: (1 << 2) | (1 << 3) };
  }

  setRule(rule) {
    if (rule && typeof rule.birth === 'number' && typeof rule.survive === 'number') {
      this.rule = { birth: rule.birth, survive: rule.survive };
    }
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
    this._history.length = 0;
  }

  clearHistory() { this._history.length = 0; }
  get historySize() { return this._history.length; }

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
    this._history.length = 0;
  }

  snapshot() { this._snapshot = new Set(this.cells); }

  reset() {
    if (!this._snapshot) return false;
    this.cells = new Set(this._snapshot);
    this.generation = 0;
    this._history.length = 0;
    return true;
  }

  /**
   * Pop the most recent saved generation off the history and restore it.
   * Returns true if a step was undone.
   */
  stepBack() {
    if (this._history.length === 0) return false;
    const prev = this._history.pop();
    this.cells = new Set(prev);
    if (this.generation > 0) this.generation--;
    return true;
  }

  /**
   * Advance one generation using the configured rule (`this.rule`).
   * Each cell's fate is decided in O(1) via two bitmask shifts.
   */
  step() {
    const live = this.cells;

    // Snapshot the pre-step state so the user can step backward. Storing as
    // an array (not a Set) makes the snapshot ~half the size and keeps
    // playback fast — Array.from on a Set is one of V8's better-tuned paths.
    if (this.historyMax > 0) {
      this._history.push(Array.from(live));
      if (this._history.length > this.historyMax) this._history.shift();
    }

    const counts = new Map();
    const { birth, survive } = this.rule;

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
      const alive = live.has(k);
      const mask = alive ? survive : birth;
      if ((mask >> n) & 1) next.add(k);
    }

    // Edge case: if S0 is set, isolated live cells (no live neighbors at all)
    // never make it into `counts` — handle them explicitly. Otherwise this
    // branch is skipped entirely so most rules pay nothing.
    if (survive & 1) {
      for (const k of live) if (!counts.has(k)) next.add(k);
    }

    this.cells = next;
    this.generation++;
  }

  /**
   * Drop every live cell outside the inclusive [wx0,wy0,wx1,wy1] rectangle.
   * Cheaper than building a Set then filtering — we replace the cell set in
   * one pass, mirroring the pattern step() uses.
   */
  cull(bounds) {
    if (!bounds) return;
    const [wx0, wy0, wx1, wy1] = bounds;
    const next = new Set();
    for (const k of this.cells) {
      const x = unpackX(k);
      if (x < wx0 || x > wx1) continue;
      const y = unpackY(k);
      if (y < wy0 || y > wy1) continue;
      next.add(k);
    }
    this.cells = next;
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
