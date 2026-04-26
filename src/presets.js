// Classic Game of Life patterns. Coords are [x, y] pairs, normalized to start near (0,0).
// `parse` accepts a compact ASCII grid: '.' or ' ' for dead, anything else (typically 'O' or '#') for live.

function parse(rows) {
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.' && ch !== ' ') out.push([x, y]);
    }
  }
  return out;
}

export const PRESETS = [
  {
    id: 'glider',
    name: 'Glider',
    cells: parse([
      '.O.',
      '..O',
      'OOO',
    ]),
  },
  {
    id: 'lwss',
    name: 'Lightweight spaceship',
    cells: parse([
      '.OOOO',
      'O...O',
      '....O',
      'O..O.',
    ]),
  },
  {
    id: 'pulsar',
    name: 'Pulsar',
    cells: parse([
      '..OOO...OOO..',
      '.............',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '..OOO...OOO..',
      '.............',
      '..OOO...OOO..',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '.............',
      '..OOO...OOO..',
    ]),
  },
  {
    id: 'pentadecathlon',
    name: 'Pentadecathlon',
    // Period-15 oscillator. Seed is a row of 10 live cells.
    cells: parse(['OOOOOOOOOO']),
  },
  {
    id: 'gosper-gun',
    name: 'Gosper glider gun',
    cells: parse([
      '........................O...........',
      '......................O.O...........',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO..............',
      'OO........O...O.OO....O.O...........',
      '..........O.....O.......O...........',
      '...........O...O....................',
      '............OO......................',
    ]),
  },
  {
    id: 'r-pentomino',
    name: 'R-pentomino (methuselah)',
    cells: parse([
      '.OO',
      'OO.',
      '.O.',
    ]),
  },
  {
    id: 'acorn',
    name: 'Acorn (methuselah)',
    cells: parse([
      '.O.....',
      '...O...',
      'OO..OOO',
    ]),
  },
  {
    id: 'diehard',
    name: 'Diehard',
    cells: parse([
      '......O.',
      'OO......',
      '.O...OOO',
    ]),
  },
  {
    id: 'blinker',
    name: 'Blinker',
    cells: parse(['OOO']),
  },
  {
    id: 'toad',
    name: 'Toad',
    cells: parse([
      '.OOO',
      'OOO.',
    ]),
  },
  {
    id: 'beacon',
    name: 'Beacon',
    cells: parse([
      'OO..',
      'OO..',
      '..OO',
      '..OO',
    ]),
  },
  {
    id: 'random',
    name: 'Random soup (60×60)',
    cells: (() => {
      const out = [];
      const W = 60, H = 60;
      // Deterministic PRNG so the soup is reproducible per click — refresh by re-selecting.
      let seed = (Date.now() & 0xffff) ^ 0x9e37;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (rand() < 0.32) out.push([x, y]);
        }
      }
      return out;
    })(),
    regenerate: true,
  },
];

// Recompute the random soup on demand so re-selecting it gives a new pattern.
export function getPreset(id) {
  const p = PRESETS.find(p => p.id === id);
  if (!p) return null;
  if (id === 'random') {
    const out = [];
    const W = 60, H = 60;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.random() < 0.32) out.push([x, y]);
      }
    }
    return { ...p, cells: out };
  }
  return p;
}
