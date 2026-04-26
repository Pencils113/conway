// Entropy mode — inject small bursts of life inside the viewport so dormant
// patterns get unstuck and the simulation never settles into pure stasis.
//
// Each "event" picks a small, survival-friendly pattern from a fixed bag and
// stamps it at a position chosen mostly near existing life (rescuing stuck
// oscillators) and occasionally uniformly across the viewport (so an empty
// canvas eventually grows life on its own).

import { unpackX, unpackY } from './life.js';

// Each entry is an array of [dx, dy] offsets relative to a placement origin.
// All have non-trivial survival odds under Conway-class rules; nothing is a
// lone cell since those always die.
const PATTERNS = [
  // Block — 2x2 still life.
  [[0,0],[1,0],[0,1],[1,1]],
  // Blinker — period-2 oscillator.
  [[0,0],[1,0],[2,0]],
  // Glider — diagonal spaceship.
  [[1,0],[2,1],[0,2],[1,2],[2,2]],
  // L-tromino — collapses to a block in two generations.
  [[0,0],[0,1],[1,1]],
  // R-pentomino — methuselah; under Conway it runs for ~1100 generations
  // before stabilizing, leaving a trail of gliders and ash.
  [[1,0],[2,0],[0,1],[1,1],[1,2]],
  // Beacon — period-2 oscillator.
  [[0,0],[1,0],[0,1],[3,2],[2,3],[3,3]],
];

const NEAR_LIFE_BIAS = 0.75;   // fraction of events anchored to an existing live cell
const NEAR_LIFE_RADIUS = 8;    // max half-width of the "near" region around the anchor

/**
 * Apply one tick of entropy to `life`. Safe to call every step — does nothing
 * if rate is 0.
 *
 * @param {object} life                            Life instance.
 * @param {[number,number,number,number]} bounds   [wx0, wy0, wx1, wy1] viewport (inclusive).
 * @param {{ rate: number }} opts                  rate = expected events per generation.
 * @returns {number} how many events actually fired.
 */
export function tick(life, bounds, opts) {
  const rate = opts.rate;
  if (!rate || rate <= 0) return 0;

  // Whole part fires unconditionally; fractional part is a single Bernoulli trial.
  let events = Math.floor(rate);
  if (Math.random() < rate - events) events++;
  if (events <= 0) return 0;

  const [wx0, wy0, wx1, wy1] = bounds;
  const vw = wx1 - wx0;
  const vh = wy1 - wy0;
  if (vw <= 0 || vh <= 0) return 0;

  // Sample a live cell once for clustering. If the world is empty, every
  // event falls back to uniform.
  const anchor = life.cells.size > 0 ? sampleLiveCell(life) : null;

  for (let e = 0; e < events; e++) {
    const pattern = PATTERNS[(Math.random() * PATTERNS.length) | 0];
    let cx, cy;
    if (anchor && Math.random() < NEAR_LIFE_BIAS) {
      const r = NEAR_LIFE_RADIUS;
      cx = anchor[0] + ((Math.random() * (2 * r + 1)) | 0) - r;
      cy = anchor[1] + ((Math.random() * (2 * r + 1)) | 0) - r;
      // Clamp to viewport so spawns never escape the visible region.
      if (cx < wx0) cx = wx0; else if (cx > wx1) cx = wx1;
      if (cy < wy0) cy = wy0; else if (cy > wy1) cy = wy1;
    } else {
      cx = wx0 + ((Math.random() * (vw + 1)) | 0);
      cy = wy0 + ((Math.random() * (vh + 1)) | 0);
    }
    for (let i = 0; i < pattern.length; i++) {
      life.add(cx + pattern[i][0], cy + pattern[i][1]);
    }
  }
  return events;
}

/**
 * Reservoir sample one live cell uniformly at random. One pass over the Set,
 * no allocation, O(population).
 */
function sampleLiveCell(life) {
  let i = 0;
  let picked = 0;
  for (const k of life.cells) {
    i++;
    if (Math.random() * i < 1) picked = k;
  }
  return [unpackX(picked), unpackY(picked)];
}
