// Offscreen sprite registry. Modules `define` painters at import time; `build()`
// realises them all once during boot. Everything the game draws comes from here, so
// the draw loop never runs a painter.

const defs = new Map();     // name -> {w,h,frames,painter,canvases}
let builtCount = 0;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return c;
}

export const Atlas = {
  define(name, w, h, painter) { this.defineAnim(name, w, h, 1, painter); },

  defineAnim(name, w, h, frames, painter) {
    if (defs.has(name)) console.warn(`[atlas] redefining "${name}"`);
    defs.set(name, { w, h, frames, painter, canvases: null });
  },

  has(name) { return defs.has(name); },
  get names() { return [...defs.keys()]; },
  get size() { return defs.size; },
  get built() { return builtCount; },

  frames(name) { return defs.get(name)?.frames ?? 0; },

  get(name, frame = 0) {
    const d = defs.get(name);
    if (!d) throw new Error(`[atlas] unknown sprite "${name}"`);
    if (!d.canvases) this._realize(name, d);
    return d.canvases[((frame | 0) % d.frames + d.frames) % d.frames];
  },

  // Safe lookup for optional art (returns null instead of throwing).
  tryGet(name, frame = 0) { return defs.has(name) ? this.get(name, frame) : null; },

  _realize(name, d) {
    d.canvases = [];
    for (let f = 0; f < d.frames; f++) {
      const c = makeCanvas(d.w, d.h);
      const ctx = c.getContext('2d');
      try { d.painter(ctx, d.w, d.h, f); }
      catch (err) { console.error(`[atlas] painter "${name}" frame ${f} failed`, err); }
      d.canvases.push(c);
    }
    builtCount++;
  },

  build(onProgress) {
    const names = [...defs.keys()];
    names.forEach((n, i) => {
      const d = defs.get(n);
      if (!d.canvases) this._realize(n, d);
      if (onProgress && (i % 24 === 0)) onProgress(i / names.length, n);
    });
    return names.length;
  },

  // Derived variant: pixel-wise recolour, cached under a new name.
  // mapFn receives and returns [r,g,b,a].
  recolor(name, suffix, mapFn) {
    const key = `${name}:${suffix}`;
    if (defs.has(key)) return key;
    const src = defs.get(name);
    if (!src) throw new Error(`[atlas] unknown sprite "${name}"`);
    this.defineAnim(key, src.w, src.h, src.frames, (ctx, w, h, f) => {
      ctx.drawImage(this.get(name, f), 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const out = mapFn([d[i], d[i + 1], d[i + 2], d[i + 3]]);
        d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
      }
      ctx.putImageData(img, 0, 0);
    });
    return key;
  },

  // Flat-colour silhouette variant (hit flashes, shadows, evolution glow).
  silhouette(name, color) {
    const key = `${name}:sil:${color}`;
    if (defs.has(key)) return key;
    const src = defs.get(name);
    this.defineAnim(key, src.w, src.h, src.frames, (ctx, w, h, f) => {
      ctx.drawImage(this.get(name, f), 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    });
    return key;
  },

  // Test/inspection helper: dump one sprite as a data URL.
  dataUrl(name, frame = 0) { return this.get(name, frame).toDataURL(); },
};

// Convenience for painters that want a scratch canvas.
export { makeCanvas };
