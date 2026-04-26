import { Life } from './life.js';
import { Renderer } from './renderer.js';
import { PRESETS, getPreset } from './presets.js';
import { findIsolatedTubCells } from './patterns.js';
import * as settings from './settings.js';
import {
  NAMED_RULES, parseRule, formatRule, findNamedRule, ruleAllowsBirthOfNothing,
} from './rules.js';
import { parseRLE } from './rle.js';
import * as entropy from './entropy.js';

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
const $hint   = document.getElementById('hint');
const $settingsBtn   = document.getElementById('settings-btn');
const $settingsModal = document.getElementById('settings-modal');
const $settingsReset = document.getElementById('settings-reset');
const $conwayMode    = document.getElementById('conway-mode');
const $fullscreenBtn = document.getElementById('fullscreen-btn');
const $rule          = document.getElementById('rule');
const $rulePreset    = document.getElementById('rule-preset');
const $ruleText      = document.getElementById('rule-text');
const $importModal   = document.getElementById('import-modal');
const $rleInput      = document.getElementById('rle-input');
const $rleStatus     = document.getElementById('rle-status');
const $rleLoad       = document.getElementById('rle-load');
const $entropyEnabled = document.getElementById('entropy-enabled');
const $entropyRate    = document.getElementById('entropy-rate');
const $entropyRateVal = document.getElementById('entropy-rate-val');
const $entropyCull    = document.getElementById('entropy-cull');

// --- Populate presets ---
for (const p of PRESETS) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.name;
  // Insert before the "+ Import RLE..." option, so import stays at the bottom.
  $preset.insertBefore(opt, $preset.querySelector('option[value="__import__"]'));
}

// --- Speed: log scale 0.5 .. 200 steps/sec ---
function speedFromSlider(v) {
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

// ============================================================================
//  Rules: top-bar selector + settings editor (digit buttons + notation field).
//  All three views are projections of the single `settings.rule` string. We
//  rebuild the dropdown contents only when needed (custom <-> named transition)
//  and toggle the digit buttons in place for the common case.
// ============================================================================

const ALL_RULE_SELECTS = [$rule, $rulePreset];
const CUSTOM_VALUE = '__custom__';

function rebuildRuleSelects(currentRule) {
  const named = findNamedRule(currentRule);
  for (const sel of ALL_RULE_SELECTS) {
    sel.innerHTML = '';
    if (!named) {
      const opt = new Option(`Custom · ${formatRule(currentRule)}`, CUSTOM_VALUE);
      sel.appendChild(opt);
    }
    for (const r of NAMED_RULES) {
      sel.appendChild(new Option(`${r.name}  ·  ${r.notation}`, r.notation));
    }
    sel.value = named ? named.notation : CUSTOM_VALUE;
  }
}

// Build digit buttons once (B0-B8 and S0-S8).
for (const row of document.querySelectorAll('[data-rule-row]')) {
  const which = row.dataset.ruleRow; // 'birth' | 'survive'
  for (let i = 0; i <= 8; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'digit-btn';
    b.textContent = String(i);
    b.dataset.bit = String(i);
    b.dataset.row = which;
    // B0 ("born from nothing") would make every empty cell alive — incompatible
    // with our sparse representation. Disable that one button.
    if (which === 'birth' && i === 0) {
      b.classList.add('disabled');
      b.title = 'B0 is not supported (every empty cell would become alive).';
    } else {
      b.addEventListener('click', () => toggleRuleBit(which, i));
    }
    row.appendChild(b);
  }
}

function toggleRuleBit(row, n) {
  const cur = parseRule(settings.get().rule);
  if (!cur) return;
  const mask = 1 << n;
  const next = { ...cur };
  if (row === 'birth')   next.birth   ^= mask;
  if (row === 'survive') next.survive ^= mask;
  if (ruleAllowsBirthOfNothing(next)) return;
  settings.setRule(next);
}

function syncRuleEditor(currentRule) {
  // Digit buttons.
  for (const btn of document.querySelectorAll('.digit-btn')) {
    const n = +btn.dataset.bit;
    const mask = 1 << n;
    const on = btn.dataset.row === 'birth'
      ? !!(currentRule.birth & mask)
      : !!(currentRule.survive & mask);
    btn.classList.toggle('on', on);
  }
  // Notation field — only update when the user isn't actively editing it.
  if (document.activeElement !== $ruleText) {
    $ruleText.value = formatRule(currentRule);
    $ruleText.classList.remove('invalid');
  }
}

// User picks a rule from either dropdown.
for (const sel of ALL_RULE_SELECTS) {
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === CUSTOM_VALUE) {
      // No-op: this option only exists to display the current custom rule.
      // Re-sync to undo any visual change.
      syncRuleSelects(parseRule(settings.get().rule));
      return;
    }
    settings.setRule(v);
  });
}

// Sync (without rebuilding) when the rule object hasn't changed shape.
function syncRuleSelects(currentRule) {
  const named = findNamedRule(currentRule);
  const target = named ? named.notation : CUSTOM_VALUE;
  let anyMissing = false;
  for (const sel of ALL_RULE_SELECTS) {
    if (![...sel.options].some(o => o.value === target)) { anyMissing = true; break; }
  }
  if (anyMissing) rebuildRuleSelects(currentRule);
  else for (const sel of ALL_RULE_SELECTS) sel.value = target;
}

// Free-form notation input.
$ruleText.addEventListener('input', () => {
  const r = parseRule($ruleText.value);
  if (!r || ruleAllowsBirthOfNothing(r)) {
    $ruleText.classList.add('invalid');
    return;
  }
  $ruleText.classList.remove('invalid');
  settings.setRule(r);
});

// --- Conway-mode pattern detection ---
function refreshHighlights() {
  if (settings.get().conwayMode) {
    renderer.highlights = findIsolatedTubCells(life);
  } else if (renderer.highlights.size) {
    renderer.highlights = new Set();
  }
}

// --- Hint legend (reflects current bindings) ---
function updateHint() {
  const b = settings.get().bindings;
  const items = [
    ['toggle', 'toggle'],
    ['pan',    'pan'],
    ['paint',  'paint'],
    ['zoom',   'zoom'],
  ];
  $hint.innerHTML = items
    .map(([cmd, label]) =>
      `<span class="pair"><kbd>${escapeHtml(b[cmd])}</kbd><span class="arr">→</span><span class="act">${label}</span></span>`)
    .join('');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (playing) {
    stepAccumulator += dt * stepsPerSecond;
    const maxStepsPerFrame = stepsPerSecond > 60 ? Math.ceil(stepsPerSecond / 30) : 1;
    let toStep = Math.floor(stepAccumulator);
    stepAccumulator -= toStep;
    if (toStep > maxStepsPerFrame * 4) toStep = maxStepsPerFrame * 4;
    for (let i = 0; i < toStep; i++) {
      stepWorld();
      // With entropy off the world can go empty and we should pause; with
      // entropy on we keep running because new life will spawn next tick.
      if (life.population === 0 && !settings.get().entropy.enabled) {
        setPlaying(false);
        break;
      }
    }
    if (toStep > 0) {
      refreshHighlights();
      updateStats();
      refreshStepBackButton();
      dirty = true;
    }
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

// --- Transport controls ---
const $stepBack = document.getElementById('step-back');

function refreshStepBackButton() {
  $stepBack.disabled = life.historySize === 0;
}

/**
 * Advance one generation and apply entropy / cull effects.
 * Centralizes the "what happens on a step" logic so play loop and manual step
 * stay in sync.
 */
function stepWorld() {
  life.step();
  const e = settings.get().entropy;
  // Cull and entropy gate independently. Either may be on without the other.
  const wantEntropy = e.enabled && e.rate > 0;
  if (wantEntropy || e.cull) {
    const bounds = renderer.viewportBounds();
    if (wantEntropy) entropy.tick(life, bounds, { rate: e.rate });
    if (e.cull)      life.cull(bounds);
  }
}

$play.addEventListener('click', () => setPlaying(!playing));
$step.addEventListener('click', () => {
  if (playing) setPlaying(false);
  stepWorld();
  refreshHighlights();
  updateStats();
  refreshStepBackButton();
  dirty = true;
});
$stepBack.addEventListener('click', () => {
  if (playing) setPlaying(false);
  if (life.stepBack()) {
    refreshHighlights();
    updateStats();
    refreshStepBackButton();
    dirty = true;
  }
});
$reset.addEventListener('click', () => {
  setPlaying(false);
  if (life.reset()) {
    refreshHighlights();
    updateStats();
    refreshStepBackButton();
    dirty = true;
  }
});
$clear.addEventListener('click', () => {
  setPlaying(false);
  life.clear();
  refreshHighlights();
  updateStats();
  refreshStepBackButton();
  dirty = true;
});
$center.addEventListener('click', () => {
  renderer.fitTo(life.bounds());
  dirty = true;
});

$preset.addEventListener('change', () => {
  const id = $preset.value;
  if (!id) return;
  if (id === '__import__') {
    $preset.value = '';
    openImport();
    return;
  }
  const p = getPreset(id);
  if (!p) return;
  loadCells(p.cells);
});

function loadCells(cells) {
  if (!cells || cells.length === 0) return;
  setPlaying(false);
  const xs = cells.map(c => c[0]);
  const ys = cells.map(c => c[1]);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  life.load(cells, -cx, -cy);
  renderer.fitTo(life.bounds(), 0.25);
  refreshHighlights();
  updateStats();
  refreshStepBackButton();
  dirty = true;
}

// ============================================================================
//  Pointer / wheel input — driven by user bindings.
//  See settings.js for the binding model. We wait for movement to disambiguate
//  click from drag; modifiers/buttons at the time of pointerdown determine the
//  drag input string ("drag", "shift+drag", "right-drag", etc).
// ============================================================================

const DRAG_THRESHOLD_PX = 4;

let pointerDown = false;
let downSnap = null;            // {button, shiftKey, altKey, ctrlKey, metaKey}
let downX = 0, downY = 0;
let lastX = 0, lastY = 0;
let movedPastThreshold = false;
let gesture = null;             // 'pan' | 'paint' | null
let paintAdd = true;
let lastPaintX = null, lastPaintY = null;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointerDown = true;
  downSnap = {
    button: e.button,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
  };
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
  movedPastThreshold = false;
  gesture = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown) return;

  if (!movedPastThreshold) {
    const dx0 = e.clientX - downX, dy0 = e.clientY - downY;
    if (dx0 * dx0 + dy0 * dy0 < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      lastX = e.clientX; lastY = e.clientY;
      return;
    }
    movedPastThreshold = true;

    const input = settings.dragInput(downSnap);
    const cmd = settings.commandForInput(input);
    if (cmd === 'pan') {
      gesture = 'pan';
      canvas.classList.add('panning');
    } else if (cmd === 'paint') {
      gesture = 'paint';
      const [wx, wy] = renderer.screenToWorld(downX, downY);
      paintAdd = !life.has(wx, wy);
      if (paintAdd) life.add(wx, wy); else life.remove(wx, wy);
      lastPaintX = wx; lastPaintY = wy;
      canvas.classList.add('painting');
      refreshHighlights();
      updateStats();
      dirty = true;
    }
  }

  if (gesture === 'pan') {
    renderer.pan(e.clientX - lastX, e.clientY - lastY);
    dirty = true;
  } else if (gesture === 'paint') {
    const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
    if (wx !== lastPaintX || wy !== lastPaintY) {
      plotLine(lastPaintX, lastPaintY, wx, wy, (x, y) => {
        if (paintAdd) life.add(x, y); else life.remove(x, y);
      });
      lastPaintX = wx; lastPaintY = wy;
      refreshHighlights();
      updateStats();
      dirty = true;
    }
  }

  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (!pointerDown) return;
  pointerDown = false;

  if (!movedPastThreshold && gesture === null) {
    const input = settings.clickInput(downSnap);
    if (settings.commandForInput(input) === 'toggle') {
      const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
      life.toggle(wx, wy);
      refreshHighlights();
      updateStats();
      dirty = true;
    }
  }

  gesture = null;
  canvas.classList.remove('panning', 'painting');
});

canvas.addEventListener('pointercancel', () => {
  pointerDown = false;
  gesture = null;
  canvas.classList.remove('panning', 'painting');
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const input = settings.wheelInput(e);
  if (settings.commandForInput(input) === 'zoom') {
    const factor = Math.exp(-e.deltaY * 0.0015);
    renderer.zoomAt(e.clientX, e.clientY, factor);
    dirty = true;
  }
}, { passive: false });

// --- Fullscreen + zen mode ---

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}
$fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
});

let zen = false;
const HISTORY_MAX = 256;
function setZen(on) {
  zen = !!on;
  document.body.classList.toggle('zen', zen);
  // Zen mode is "screensaver" mode — pure forward propagation. Disable history
  // snapshotting entirely so the step loop has zero per-step bookkeeping cost,
  // and free the buffer that's already been collected.
  if (zen) {
    life.historyMax = 0;
    life.clearHistory();
    refreshStepBackButton();
  } else {
    life.historyMax = HISTORY_MAX;
    refreshStepBackButton();
  }
}

// --- Keyboard ---
window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    // Inside text fields, only honor a couple of high-value shortcuts.
    if (e.key === 'Escape') {
      if (!$importModal.hidden)   { closeImport();   e.target.blur(); return; }
      if (!$settingsModal.hidden) { closeSettings(); e.target.blur(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$importModal.hidden) {
      e.preventDefault();
      $rleLoad.click();
    }
    return;
  }
  if (e.key === 'Escape') {
    // Browser handles ESC for fullscreen on its own. Use ESC to close modal or
    // exit zen, in that priority order.
    if (!$importModal.hidden)   { closeImport();   return; }
    if (!$settingsModal.hidden) { closeSettings(); return; }
    if (zen) { setZen(false); return; }
  }
  switch (e.key) {
    case ' ': e.preventDefault(); setPlaying(!playing); break;
    case 'ArrowRight':
    case 'n': $step.click(); break;
    case 'ArrowLeft':
    case 'p': $stepBack.click(); break;
    case 'r': $reset.click(); break;
    case 'c': $clear.click(); break;
    case 'f': $center.click(); break;
    case 's': openSettings(); break;
    case 'h': setZen(!zen); break;
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

// ============================================================================
//  Settings modal
// ============================================================================

function openSettings() {
  $settingsModal.hidden = false;
  syncSettingsUI();
}
function closeSettings() {
  $settingsModal.hidden = true;
}

$settingsBtn.addEventListener('click', openSettings);
$settingsModal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeSettings();
});
$settingsReset.addEventListener('click', () => settings.reset());

$conwayMode.addEventListener('change', () => {
  settings.setConwayMode($conwayMode.checked);
});

// Entropy controls.
$entropyEnabled.addEventListener('change', () => {
  settings.setEntropy({ enabled: $entropyEnabled.checked });
});
$entropyRate.addEventListener('input', () => {
  settings.setEntropy({ rate: +$entropyRate.value });
});
$entropyCull.addEventListener('change', () => {
  settings.setEntropy({ cull: $entropyCull.checked });
});

function fmtEntropyRate(r) { return r.toFixed(1); }

// Build binding select dropdowns once.
for (const sel of $settingsModal.querySelectorAll('select[data-bind]')) {
  const cmd = sel.dataset.bind;
  for (const opt of settings.OPTIONS[cmd]) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => settings.setBinding(cmd, sel.value));
}

// ============================================================================
//  RLE import
// ============================================================================

function openImport() {
  $importModal.hidden = false;
  $rleStatus.textContent = '';
  $rleStatus.className = 'rle-status';
  setTimeout(() => $rleInput.focus(), 0);
}
function closeImport() {
  $importModal.hidden = true;
}

$importModal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeImport();
});

$rleInput.addEventListener('input', () => {
  $rleStatus.textContent = '';
  $rleStatus.className = 'rle-status';
});

$rleLoad.addEventListener('click', () => {
  const result = parseRLE($rleInput.value);
  if (result.error) {
    flashStatus($rleStatus, result.error, 'error');
    return;
  }
  if (!result.cells.length) {
    flashStatus($rleStatus, 'Pattern parsed but contained no live cells.', 'error');
    return;
  }
  // If the file declared a rule, switch to it.
  if (result.rule) settings.setRule(result.rule);

  loadCells(result.cells);
  closeImport();
});

function flashStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = `rle-status ${kind || ''}`;
}

function syncSettingsUI() {
  const s = settings.get();
  $conwayMode.checked = s.conwayMode;
  $entropyEnabled.checked = s.entropy.enabled;
  $entropyRate.value      = s.entropy.rate;
  $entropyRateVal.textContent = fmtEntropyRate(s.entropy.rate);
  $entropyRate.style.setProperty('--pct', `${(s.entropy.rate / 5) * 100}%`);
  $entropyCull.checked    = s.entropy.cull;
  for (const sel of $settingsModal.querySelectorAll('select[data-bind]')) {
    sel.value = s.bindings[sel.dataset.bind];
  }
}

// React to settings changes from anywhere (modal, reset, programmatic).
settings.subscribe((s) => {
  syncSettingsUI();
  updateHint();
  // Apply the rule to the simulation. Step calls will use the new rule from
  // the very next tick — no recompute needed.
  const r = parseRule(s.rule) || parseRule('B3/S23');
  life.setRule(r);
  syncRuleSelects(r);
  syncRuleEditor(r);
  // Conway-mode body class drives the zen-mode wordmark overlay.
  document.body.classList.toggle('conway-mode', !!s.conwayMode);
  refreshHighlights();
  dirty = true;
});

// --- Initial state ---
{
  const s = settings.get();
  const r = parseRule(s.rule) || parseRule('B3/S23');
  life.setRule(r);
  rebuildRuleSelects(r);
  syncRuleEditor(r);
  document.body.classList.toggle('conway-mode', !!s.conwayMode);
}
updateHint();
const intro = getPreset('glider');
life.load(intro.cells, -1, -1);
renderer.fitTo(life.bounds(), 0.45);
refreshHighlights();
updateStats();
refreshStepBackButton();
dirty = true;
