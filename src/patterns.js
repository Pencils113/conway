// Pattern recognition for Conway-mode highlighting.
//
// "Isolated tub": the four-cell still life
//
//        .O.
//        O.O
//        .O.
//
// where the surrounding 5x5 region (centered on the empty middle cell) contains
// *only* those four cells and no other live cells. Any neighbor would either
// disrupt isolation or change the pattern's behavior, so we require strict
// emptiness in the buffer ring.

import { pack, unpackX, unpackY } from './life.js';

export function findIsolatedTubCells(life) {
  const out = new Set();
  if (life.cells.size < 4) return out;

  for (const k of life.cells) {
    const x = unpackX(k);
    const y = unpackY(k);

    // Treat (x, y) as the TOP cell of a candidate tub. The tub's empty center
    // is then at (x, y + 1). Using the top as the anchor guarantees we only
    // discover each tub once (top is the lex-min cell).
    const cx = x;
    const cy = y + 1;

    // Required live cells (the other three arms of the tub):
    if (!life.has(cx - 1, cy))     continue;
    if (!life.has(cx + 1, cy))     continue;
    if (!life.has(cx,     cy + 1)) continue;
    // Center must be empty:
    if (life.has(cx, cy))          continue;

    // Isolation: the whole 5x5 region centered on (cx, cy) must contain
    // exactly the four tub cells and nothing else.
    let isolated = true;
    for (let dy = -2; dy <= 2 && isolated; dy++) {
      for (let dx = -2; dx <= 2 && isolated; dx++) {
        if (dx === 0 && dy === 0) continue; // center is dead, already checked
        const isTubArm =
          (dx === 0 && (dy === -1 || dy === 1)) ||
          (dy === 0 && (dx === -1 || dx === 1));
        const alive = life.has(cx + dx, cy + dy);
        if (alive !== isTubArm) isolated = false;
      }
    }

    if (isolated) {
      out.add(pack(cx,     cy - 1));
      out.add(pack(cx - 1, cy));
      out.add(pack(cx + 1, cy));
      out.add(pack(cx,     cy + 1));
    }
  }
  return out;
}
