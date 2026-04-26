import { Life } from './life.js';
import { Renderer } from './renderer.js';
import { PRESETS, getPreset } from './presets.js';

const canvas = document.getElementById('stage');
const life = new Life();
const renderer = new Renderer(canvas, life);

// --- DOM refs ---
const $gen   = document.getElementById('gen');
const $pop   = document.getElementById('pop');
const $fps   = document.getElementById('fps');
const $play  = document.getElementById('play');
const $step  = document.getElementById('step');
const $reset = document.getElementById('reset');
const $clear = document.getElementById('clear');
const $center = document.getElementById('center');
const $speed = document.getElementById('speed');
const $speedVal = document.getElementById('speed-val');
const $preset = document.getElementById('preset');

// --- Populate presets ---
for (const p of PRESETS) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.name;
  $preset.appendChild(opt);
}

// --- Speed: log scale 0.5 .. 200 steps/sec ---
function speedFromSlider(v) {
  // v: 0..100 -> sps: 0.5..200 logarithmic
  const t = v / 100;
  const lo = Math.log(0.5);
  const hi = Math.log(200);
  return Math.exp(lo + (hi - lo) * t);
}
function fmtSpeed(sps) {
  if (sps >= 100) return `${Math.round(sps)}/s`;
  if (sps >= 10)  return `${sps.toFixed(0)}/s`;
  if (sps >= 1)   return `${sps.toFixed(1)}/s`;
  return `${sps.toFixed(2)}/s`;
}
let stepsPerSecond = speedFromSlider(+$speed.value);
function updateSpeedUI() {
  $speedVal.textContent = fmtSpeed(stepsPerSecond);
  $speed.style.setProperty('--pct', `${$speed.value}%`);
}
$speed.addEventListener('input', () => {
  stepsPerSecond = speedFromSlider(+$speed.value);
  updateSpeedUI();
});
updateSpeedUI();

// --- Stats ---
function updateStats() {
  $gen.textContent = life.generation.toLocaleString();
  $pop.textContent = life.population.toLocaleString();
}

// --- Playback ---
let playing = false;
let lastFrame = 0;
let stepAccumulator = 0;
let dirty = true;
let fpsEMA = 0;

function setPlaying(p) {
  playing = p;
  document.body.classList.toggle('playing', playing);
  if (playing) {
    lastFrame = performance.now();
    stepAccumulator = 0;
  }
}

function loop(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000); // clamp at 250ms to avoid huge catch-up jumps
  lastFrame = now;

  if (playing) {
    stepAccumulator += dt * stepsPerSecond;
    // Cap how many steps per frame to keep UI responsive.
    const maxStepsPerFrame = stepsPerSecond > 60 ? Math.ceil(stepsPerSecond / 30) : 1;
    let toStep = Math.floor(stepAccumulator);
    stepAccumulator -= toStep;
    if (toStep > maxStepsPerFrame * 4) toStep = maxStepsPerFrame * 4; // hard cap
    for (let i = 0; i < toStep; i++) {
      life.step();
      if (life.population === 0) { setPlaying(false); break; }
    }
    if (toStep > 0) { dirty = true; updateStats(); }
  }

  if (dirty) {
    renderer.draw();
    dirty = false;
  }

  if (dt > 0) {
    const inst = 1 / dt;
    fpsEMA = fpsEMA === 0 ? inst : fpsEMA * 0.9 + inst * 0.1;
    $fps.textContent = Math.round(fpsEMA).toString();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame((t) => { lastFrame = t; loop(t); });

// --- Controls ---
$play.addEventListener('click', () => setPlaying(!playing));
$step.addEventListener('click', () => {
  if (playing) setPlaying(false);
  life.step();
  updateStats();
  dirty = true;
});
$reset.addEventListener('click', () => {
  setPlaying(false);
  if (life.reset()) { updateStats(); dirty = true; }
});
$clear.addEventListener('click', () => {
  setPlaying(false);
  life.clear();
  updateStats();
  dirty = true;
});
$center.addEventListener('click', () => {
  renderer.fitTo(life.bounds());
  dirty = true;
});

$preset.addEventListener('change', () => {
  const id = $preset.value;
  if (!id) return;
  const p = getPreset(id);
  if (!p) return;
  setPlaying(false);
  // Center the pattern at world origin.
  const xs = p.cells.map(c => c[0]);
  const ys = p.cells.map(c => c[1]);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  life.load(p.cells, -cx, -cy);
  renderer.fitTo(life.bounds(), 0.25);
  updateStats();
  dirty = true;
});

// --- Mouse: pan, zoom, paint ---
let pointerDown = false;
let panMode = false;
let paintMode = null; // 'add' | 'remove' | null
let lastPanX = 0, lastPanY = 0;
let lastPaintX = null, lastPaintY = null;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointerDown = true;
  lastPanX = e.clientX;
  lastPanY = e.clientY;

  // Middle-click or space-drag = pan; left = toggle/paint; shift = continuous paint
  if (e.button === 1 || e.button === 2 || e.altKey) {
    panMode = true;
    canvas.classList.add('panning');
    return;
  }
  panMode = false;
  const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
  if (e.shiftKey) {
    paintMode = life.has(wx, wy) ? 'remove' : 'add';
    if (paintMode === 'add') life.add(wx, wy); else life.remove(wx, wy);
  } else {
    life.toggle(wx, wy);
    paintMode = null; // single toggle, will not paint on move unless shift
  }
  lastPaintX = wx; lastPaintY = wy;
  canvas.classList.add('painting');
  updateStats();
  dirty = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown) return;
  if (panMode) {
    const dx = e.clientX - lastPanX;
    const dy = e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    renderer.pan(dx, dy);
    dirty = true;
    return;
  }

  if (paintMode) {
    // Bresenham-ish line between last and current to avoid gaps when moving fast.
    const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
    if (wx === lastPaintX && wy === lastPaintY) return;
    plotLine(lastPaintX, lastPaintY, wx, wy, (x, y) => {
      if (paintMode === 'add') life.add(x, y);
      else life.remove(x, y);
    });
    lastPaintX = wx; lastPaintY = wy;
    updateStats();
    dirty = true;
  }
});

canvas.addEventListener('pointerup', (e) => {
  pointerDown = false;
  panMode = false;
  paintMode = null;
  canvas.classList.remove('panning', 'painting');
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  renderer.zoomAt(e.clientX, e.clientY, factor);
  dirty = true;
}, { passive: false });

// Pan with drag of any other element on body? — handled within canvas only.

// --- Keyboard ---
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.key) {
    case ' ': e.preventDefault(); setPlaying(!playing); break;
    case 'ArrowRight':
    case 'n': $step.click(); break;
    case 'r': $reset.click(); break;
    case 'c': $clear.click(); break;
    case 'f': $center.click(); break;
    case '+': case '=': renderer.zoomAt(window.innerWidth/2, window.innerHeight/2, 1.2); dirty = true; break;
    case '-': case '_': renderer.zoomAt(window.innerWidth/2, window.innerHeight/2, 1/1.2); dirty = true; break;
  }
});

// --- Resize ---
const resize = () => { renderer.resize(); dirty = true; };
window.addEventListener('resize', resize);

// --- Bresenham line for paint ---
function plotLine(x0, y0, x1, y1, plot) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// --- Initial state: drop in a glider so it's not boringly empty ---
const intro = getPreset('glider');
life.load(intro.cells, -1, -1);
renderer.fitTo(life.bounds(), 0.45);
updateStats();
dirty = true;
