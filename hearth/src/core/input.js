// Input: keyboard + gamepad + touch -> logical buttons.
// Responsiveness is a headline quality target, so presses are edge-buffered: a tap
// that starts and ends inside one logical frame still registers.

const BTNS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select', 'run'];

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Space: 'a', Enter: 'a', NumpadEnter: 'a',
  KeyX: 'b', Escape: 'b', Backspace: 'b',
  ShiftLeft: 'run', ShiftRight: 'run',
  Tab: 'select', KeyC: 'select',
  KeyM: 'start', Slash: 'start',
};

const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'a', 1: 'b', 2: 'run', 9: 'start', 8: 'select' };

const down = new Set();
const pressed = new Set();
const released = new Set();
const consumed = new Set();
const dirStack = [];             // most recently pressed direction wins
let padPrev = new Set();
let anyPress = false;
let lastInputAt = 0;

function setDown(btn) {
  if (!btn || down.has(btn)) return;
  down.add(btn); pressed.add(btn); anyPress = true;
  lastInputAt = performance.now();
  if (btn === 'up' || btn === 'down' || btn === 'left' || btn === 'right') {
    const i = dirStack.indexOf(btn); if (i >= 0) dirStack.splice(i, 1);
    dirStack.push(btn);
  }
}
function setUp(btn) {
  if (!btn || !down.has(btn)) return;
  down.delete(btn); released.add(btn); consumed.delete(btn);
  const i = dirStack.indexOf(btn); if (i >= 0) dirStack.splice(i, 1);
}

export const Input = {
  enabled: true,

  held(b) { return this.enabled && down.has(b) && !consumed.has(b); },
  pressed(b) { return this.enabled && pressed.has(b) && !consumed.has(b); },
  released(b) { return this.enabled && released.has(b); },
  consume(b) { consumed.add(b); pressed.delete(b); },
  anyPressed() { return this.enabled && anyPress; },
  get idleMs() { return performance.now() - lastInputAt; },

  dir() {
    if (!this.enabled) return null;
    for (let i = dirStack.length - 1; i >= 0; i--) {
      if (!consumed.has(dirStack[i])) return dirStack[i];
    }
    return null;
  },

  axis() {
    const x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const y = (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
    return { x, y };
  },

  // Called once per logical frame, at the very end.
  endFrame() {
    pressed.clear(); released.clear(); anyPress = false;
  },

  pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const now = new Set();
    for (const p of pads) {
      if (!p) continue;
      p.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) now.add(PAD[i]); });
      const [ax, ay] = p.axes;
      if (ax < -.45) now.add('left'); else if (ax > .45) now.add('right');
      if (ay < -.45) now.add('up'); else if (ay > .45) now.add('down');
    }
    for (const b of now) if (!padPrev.has(b)) setDown(b);
    for (const b of padPrev) if (!now.has(b)) setUp(b);
    padPrev = now;
  },

  // Test/automation hook: hold a button for `frames` logical frames.
  _scripted: [],
  script(btn, frames = 2) { this._scripted.push({ btn, frames }); },
  runScripted() {
    for (let i = this._scripted.length - 1; i >= 0; i--) {
      const s = this._scripted[i];
      if (s.frames === undefined) continue;
      if (!down.has(s.btn)) setDown(s.btn);
      if (--s.frames <= 0) { setUp(s.btn); this._scripted.splice(i, 1); }
    }
  },
};

export function initInput(root = window) {
  root.addEventListener('keydown', e => {
    const btn = KEYMAP[e.code];
    if (btn) { e.preventDefault(); if (!e.repeat) setDown(btn); }
  }, { passive: false });
  root.addEventListener('keyup', e => {
    const btn = KEYMAP[e.code];
    if (btn) { e.preventDefault(); setUp(btn); }
  }, { passive: false });
  root.addEventListener('blur', () => { for (const b of [...down]) setUp(b); });

  initTouch();

  // Expose for Playwright-driven gameplay tests.
  window.__press = (btn, frames = 3) => Input.script(btn, frames);
  window.__inputState = () => ({ down: [...down], dir: Input.dir() });
}

function initTouch() {
  const pad = document.getElementById('tpad');
  const knob = pad?.querySelector('i');
  const bind = (el, btn) => {
    if (!el) return;
    const on = e => { e.preventDefault(); el.classList.add('on'); setDown(btn); };
    const off = e => { e.preventDefault(); el.classList.remove('on'); setUp(btn); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  bind(document.getElementById('tA'), 'a');
  bind(document.getElementById('tB'), 'b');
  bind(document.getElementById('tM'), 'start');

  if (!pad) return;
  let active = false;
  const DEAD = 14;
  const update = (e) => {
    const r = pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const max = r.width / 2 - 16;
    if (knob) {
      const k = len > max ? max / len : 1;
      knob.style.transform = `translate(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px)`;
    }
    const want = len < DEAD ? null
      : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    for (const d of ['up', 'down', 'left', 'right']) {
      if (d === want) setDown(d); else setUp(d);
    }
    // Holding the pad past the ring = run, mirroring an analog stick's outer range.
    if (len > max * .82) setDown('run'); else setUp('run');
  };
  const end = e => {
    e.preventDefault(); active = false;
    if (knob) knob.style.transform = '';
    for (const d of ['up', 'down', 'left', 'right', 'run']) setUp(d);
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); active = true; pad.setPointerCapture(e.pointerId); update(e); });
  pad.addEventListener('pointermove', e => { if (active) { e.preventDefault(); update(e); } });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}
