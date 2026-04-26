# conway

An interactive Conway's Game of Life that lives on an infinite plane.
Pan, zoom, paint cells, drop in classic patterns, and watch them evolve at up to 200 steps/sec.

Designed as a sandbox for Game of Life **variants** — the basic B3/S23 ruleset is the
first stop. More variants (HighLife, Day & Night, Seeds, custom rules, multi-state…) coming next.

## Run locally

Requires [`uv`](https://github.com/astral-sh/uv).

```sh
uv run serve.py
# → http://127.0.0.1:8765/
```

Or pick a different port:

```sh
uv run serve.py --port 5757
```

## Controls

| input | action |
| --- | --- |
| `click` | toggle a cell |
| `shift + drag` | paint / erase a stroke of cells |
| `drag` (alt / middle / right) | pan |
| `scroll` | zoom (centered on the cursor) |
| `space` | play / pause |
| `→` or `n` | step one generation |
| `r` | reset to last loaded pattern |
| `c` | clear the grid |
| `f` | recenter view on the live population |
| `+` / `-` | zoom in / out |

## How it works

- **Sparse, infinite grid.** Live cells are stored in a `Set` of 32-bit packed `(x,y)`
  keys. Stepping is `O(live cells)` — empty space is free.
- **Two render paths.** At zoom ≥ 3 px/cell we draw rects; below that we splat directly
  into an `ImageData` buffer so huge populations stay smooth.
- **Decoupled simulation rate.** Steps/sec is independent of the framerate; the loop
  catches up while remaining responsive.

## Project layout

```
index.html         # markup + HUD
styles.css         # dark purple/indigo theme
src/life.js        # B3/S23 simulation
src/renderer.js    # canvas pan/zoom + cell drawing
src/presets.js     # classic patterns
src/app.js         # wiring + input
serve.py           # tiny dev server (uv run serve.py)
pyproject.toml     # uv project config
```
