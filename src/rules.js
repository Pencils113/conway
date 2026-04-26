// Rule definitions for B/S-style cellular automata.
//
// A rule is a 9-bit `birth` mask and a 9-bit `survive` mask. Bit n means
// "applies when a cell has exactly n live neighbors", n ∈ [0..8].
//
// Storing as integer bitmasks lets `step()` decide each cell's fate with a
// single shift+AND, which is faster and tidier than array lookups.

/** Build a rule from arrays of birth and survive neighbor counts. */
export function ruleFromBS(birthCounts, surviveCounts) {
  let b = 0, s = 0;
  for (const n of birthCounts) if (n >= 0 && n <= 8) b |= (1 << n);
  for (const n of surviveCounts) if (n >= 0 && n <= 8) s |= (1 << n);
  return { birth: b, survive: s };
}

/**
 * Parse rule notation. Accepts: "B3/S23", "b3/s23", "3/23", "B3S23".
 * Returns null if the input isn't valid.
 */
export function parseRule(notation) {
  if (!notation) return null;
  const m = String(notation).trim().match(/^B?([0-8]*)\s*\/?\s*S?([0-8]*)$/i);
  if (!m) return null;
  const bDigits = [...new Set(m[1].split(''))].map(Number);
  const sDigits = [...new Set(m[2].split(''))].map(Number);
  return ruleFromBS(bDigits, sDigits);
}

/** Render a rule as canonical "B__/S__" notation. */
export function formatRule(rule) {
  let b = '', s = '';
  for (let i = 0; i <= 8; i++) {
    if (rule.birth   & (1 << i)) b += i;
    if (rule.survive & (1 << i)) s += i;
  }
  return `B${b}/S${s}`;
}

export function rulesEqual(a, b) {
  return a && b && a.birth === b.birth && a.survive === b.survive;
}

/** B0 makes every empty cell come alive — incompatible with sparse storage. */
export function ruleAllowsBirthOfNothing(rule) {
  return (rule.birth & 1) !== 0;
}

const decl = (id, name, notation) => {
  const r = parseRule(notation);
  return { id, name, notation, ...r };
};

export const NAMED_RULES = [
  decl('conway',     "Conway's Life",      'B3/S23'),
  decl('highlife',   'HighLife',           'B36/S23'),
  decl('day-night',  'Day & Night',        'B3678/S34678'),
  decl('seeds',      'Seeds',              'B2/S'),
  decl('lwd',        'Life without Death', 'B3/S012345678'),
  decl('maze',       'Maze',               'B3/S12345'),
  decl('mazectric',  'Mazectric',          'B3/S1234'),
  decl('2x2',        '2×2',                'B36/S125'),
  decl('replicator', 'Replicator',         'B1357/S1357'),
  decl('diamoeba',   'Diamoeba',           'B35678/S5678'),
  decl('anneal',     'Anneal',             'B4678/S35678'),
];

export const DEFAULT_RULE = NAMED_RULES[0]; // Conway's Life

export function findNamedRule(rule) {
  for (const r of NAMED_RULES) if (rulesEqual(r, rule)) return r;
  return null;
}
