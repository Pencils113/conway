// RLE (Run-Length Encoded) Life pattern parser.
// Spec: https://conwaylife.com/wiki/Run_Length_Encoded
//
// A typical RLE looks like:
//   #N Glider
//   #C The smallest, most common, and first discovered spaceship.
//   x = 3, y = 3, rule = B3/S23
//   bob$2bo$3o!
//
// Tokens in the body: optional digits (run length, default 1) followed by:
//   b   dead cell
//   o   live cell
//   $   end of row
//   !   end of pattern
// Whitespace is ignored. We tolerate any other letter as "live" (some
// generations-style RLE uses A-X for state, all of which we treat as alive).

import { parseRule } from './rules.js';

/**
 * @returns { cells: Array<[number, number]>, rule: object|null,
 *            name: string|null, comments: string[],
 *            width: number, height: number }
 *          or { error: string } on failure.
 */
export function parseRLE(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'Empty input.' };
  }

  const lines = text.split(/\r?\n/);
  const comments = [];
  let name = null;
  let header = null;
  let bodyStartIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      // #N <name>, #C/#D <comment>, #O <author>, #P/#R <position>, etc.
      const tag = line[1];
      const rest = line.slice(2).trim();
      if (tag === 'N' && !name) name = rest;
      else if (rest) comments.push(rest);
      continue;
    }

    // Header line, e.g. "x = 3, y = 3, rule = B3/S23"
    const hMatch = line.match(/x\s*=\s*(\d+)[ ,;]+y\s*=\s*(\d+)(?:[ ,;]+rule\s*=\s*([^\s,;]+))?/i);
    if (hMatch) {
      const width = parseInt(hMatch[1], 10);
      const height = parseInt(hMatch[2], 10);
      const ruleStr = hMatch[3] || null;
      header = { width, height, rule: ruleStr ? parseRule(ruleStr) : null, ruleStr };
      bodyStartIdx = i + 1;
      break;
    }

    // No header found before the body.
    bodyStartIdx = i;
    break;
  }

  if (bodyStartIdx === -1) return { error: 'No pattern body found.' };

  const body = lines.slice(bodyStartIdx).join('').replace(/\s+/g, '');
  if (!body) return { error: 'Pattern body is empty.' };

  const cells = [];
  let x = 0, y = 0;
  let run = 0;
  let maxX = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (ch >= '0' && ch <= '9') {
      run = run * 10 + (ch.charCodeAt(0) - 48);
      continue;
    }

    const count = run === 0 ? 1 : run;
    run = 0;

    if (ch === 'b' || ch === '.') {
      x += count;
    } else if (ch === '$') {
      y += count;
      if (x > maxX) maxX = x;
      x = 0;
    } else if (ch === '!') {
      break;
    } else {
      // Any other letter (o, A-X, etc.) we treat as live.
      for (let k = 0; k < count; k++) cells.push([x + k, y]);
      x += count;
    }
  }
  if (x > maxX) maxX = x;

  return {
    cells,
    rule: header?.rule || null,
    ruleStr: header?.ruleStr || null,
    name,
    comments,
    width: header?.width ?? maxX,
    height: header?.height ?? (y + 1),
  };
}
