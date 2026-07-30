// Scene stack. Overworld sits at the bottom; menus, dialogue, and build mode push on
// top of it. A scene may ask to keep the scene below it drawing (drawsBelow) and/or
// updating (pausesBelow: false) — that's how the pause menu renders over the world.

const registry = new Map();
export const stack = [];

let pendingResolve = null;

export const Scenes = {
  register(name, factory) { registry.set(name, factory); },
  get stack() { return stack; },
  get top() { return stack[stack.length - 1] || null; },
  get topName() { return this.top?.__name || null; },
  has(name) { return registry.has(name); },
  isActive(name) { return stack.some(s => s.__name === name); },

  make(name, params) {
    const f = registry.get(name);
    if (!f) throw new Error(`[scene] unknown scene "${name}"`);
    const s = f();
    s.__name = name;
    if (s.pausesBelow === undefined) s.pausesBelow = true;
    if (s.drawsBelow === undefined) s.drawsBelow = false;
    s.__params = params;
    return s;
  },

  push(name, params) {
    const s = this.make(name, params);
    stack.push(s);
    s.enter?.(params);
    return s;
  },

  // Resolves with whatever is handed to pop().
  pushAsync(name, params) {
    return new Promise(res => {
      const s = this.push(name, params);
      s.__resolve = res;
    });
  },

  pop(result) {
    const s = stack.pop();
    if (!s) return;
    s.exit?.(result);
    s.__resolve?.(result);
    return s;
  },

  replace(name, params) {
    const s = stack.pop();
    s?.exit?.();
    s?.__resolve?.(undefined);
    return this.push(name, params);
  },

  // Drop everything and start fresh (used by title -> new game, and by resetSave).
  reset(name, params) {
    while (stack.length) { const s = stack.pop(); s.exit?.(); }
    return this.push(name, params);
  },

  popTo(name) {
    while (stack.length > 1 && this.topName !== name) this.pop();
  },

  update(dt) {
    // Walk from the top down; stop updating once a scene claims the pause.
    let i = stack.length - 1;
    const toUpdate = [];
    while (i >= 0) {
      toUpdate.push(stack[i]);
      if (stack[i].pausesBelow) break;
      i--;
    }
    for (let k = toUpdate.length - 1; k >= 0; k--) toUpdate[k].update?.(dt);
  },

  render(alpha) {
    // Find the lowest scene that must draw, then render upward.
    let i = stack.length - 1;
    while (i > 0 && stack[i].drawsBelow) i--;
    for (; i < stack.length; i++) stack[i].render?.(alpha);
  },
};
