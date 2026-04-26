// Persistent user settings: input bindings + feature toggles.
// All state is single-source-of-truth here; views subscribe to changes.

const STORAGE_KEY = 'conway.settings.v1';

export const DEFAULTS = Object.freeze({
  conwayMode: false,
  bindings: {
    toggle: 'click',
    pan:    'drag',
    paint:  'shift+drag',
    zoom:   'scroll',
  },
});

// Allowed inputs per command. Order matters — first viable option is used as a
// fallback when resolving conflicts.
export const OPTIONS = Object.freeze({
  toggle: ['click', 'shift+click', 'alt+click'],
  pan:    ['drag', 'shift+drag', 'alt+drag', 'right-drag', 'middle-drag'],
  paint:  ['drag', 'shift+drag', 'alt+drag'],
  zoom:   ['scroll', 'shift+scroll', 'ctrl+scroll'],
});

const COMMAND_LABEL = {
  toggle: 'Toggle cell',
  pan:    'Pan',
  paint:  'Paint cells',
  zoom:   'Zoom',
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      conwayMode: !!parsed.conwayMode,
      bindings: {
        ...DEFAULTS.bindings,
        ...sanitizeBindings(parsed.bindings || {}),
      },
    };
  } catch {
    return clone(DEFAULTS);
  }
}

function sanitizeBindings(b) {
  const out = {};
  for (const cmd of Object.keys(DEFAULTS.bindings)) {
    if (OPTIONS[cmd].includes(b[cmd])) out[cmd] = b[cmd];
  }
  return out;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function emit() { for (const fn of listeners) fn(state); }

export function get() { return state; }
export function label(cmd) { return COMMAND_LABEL[cmd] || cmd; }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setConwayMode(on) {
  state.conwayMode = !!on;
  save();
  emit();
}

/**
 * Set a binding, automatically resolving conflicts: if another command had this
 * input, that command is reassigned to its first available alternative.
 */
export function setBinding(command, input) {
  if (!OPTIONS[command]?.includes(input)) return;

  // Free this command's slot, then displace any other command that had the input.
  const previous = state.bindings[command];
  state.bindings[command] = input;

  for (const cmd of Object.keys(state.bindings)) {
    if (cmd === command) continue;
    if (state.bindings[cmd] !== input) continue;
    // Conflict — pick first option for cmd that nobody else has.
    const taken = new Set(
      Object.entries(state.bindings)
        .filter(([c]) => c !== cmd)
        .map(([, v]) => v)
    );
    const fallback = OPTIONS[cmd].find(o => !taken.has(o)) ?? previous ?? OPTIONS[cmd][0];
    state.bindings[cmd] = fallback;
  }

  save();
  emit();
}

export function reset() {
  state = clone(DEFAULTS);
  save();
  emit();
}

/** Build the input string for a click (no movement) on left button. */
export function clickInput(modSnap) {
  const m = modPrefix(modSnap);
  return m ? `${m}+click` : 'click';
}

/** Build the input string for a drag, given the press's button + modifier snapshot. */
export function dragInput(modSnap) {
  if (modSnap.button === 2) return 'right-drag';
  if (modSnap.button === 1) return 'middle-drag';
  const m = modPrefix(modSnap);
  return m ? `${m}+drag` : 'drag';
}

/** Build the input string for a wheel event. */
export function wheelInput(e) {
  const m = modPrefix(e);
  return m ? `${m}+scroll` : 'scroll';
}

function modPrefix(e) {
  if (e.shiftKey) return 'shift';
  if (e.altKey) return 'alt';
  if (e.ctrlKey || e.metaKey) return 'ctrl';
  return '';
}

/** Reverse-lookup: which command (if any) is bound to this input string? */
export function commandForInput(input) {
  const b = state.bindings;
  for (const cmd of Object.keys(b)) {
    if (b[cmd] === input) return cmd;
  }
  return null;
}
