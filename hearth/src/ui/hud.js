// The overworld HUD.
//
// It has to answer "when is it, what do I have, how is my team, where am I" without
// getting in the way of the world. So: small, cornered, semi-transparent, and it
// shrinks out of the way whenever dialogue is open.

import { R, LAYER } from '../core/renderer.js';
import { Atlas } from '../art/atlas.js';
import { UIx, Hooks } from '../core/bridge.js';
import { Font } from '../core/font.js';
import { S } from '../state.js';
import { P, mix, shade } from '../art/palette.js';
import { clamp, ease } from '../core/util.js';
import { Frame, seasonIcon, skyIcon } from './frame.js';
import { clockText, timeOfDay } from '../world/daynight.js';

const toasts = [];
let hide = 0;            // 0 = fully shown, 1 = fully tucked away
let t = 0;

// --- minimap -----------------------------------------------------------------
// Rebuilt only when the map changes: 1px per tile, colour-coded by walkability so
// it reads as a map rather than a thumbnail of the tiles.
let miniFor = null, mini = null;

function buildMinimap(map) {
  const c = document.createElement('canvas');
  c.width = map.w; c.height = map.h;
  const x = c.getContext('2d');
  const img = x.createImageData(map.w, map.h);
  const put = (i, hex, a = 255) => {
    img.data[i] = parseInt(hex.slice(1, 3), 16);
    img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i + 3] = a;
  };
  for (let yy = 0; yy < map.h; yy++) {
    for (let xx = 0; xx < map.w; xx++) {
      const i = (yy * map.w + xx) * 4;
      if (map.isWater(xx, yy)) put(i, '#2b7fae');
      else if (map.solid(xx, yy)) put(i, '#3d2f22');
      else if (map.isGrass(xx, yy)) put(i, '#4f8b31');
      else if (map.tag(xx, yy) === 'door') put(i, '#f5c877');
      else put(i, '#8cc055');
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

function drawMinimap(map, x, y, w, h) {
  if (!map) return;
  if (miniFor !== map.id) { mini = buildMinimap(map); miniFor = map.id; }
  Frame.panel(x, y, w, h, { style: 'dark', alpha: 0.82 });
  const iw = w - 6, ih = h - 6;
  const s = Math.min(iw / map.w, ih / map.h);
  const dw = Math.max(1, Math.round(map.w * s)), dh = Math.max(1, Math.round(map.h * s));
  const dx = Math.round(x + 3 + (iw - dw) / 2), dy = Math.round(y + 3 + (ih - dh) / 2);
  const ctx = R.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(mini, dx, dy, dw, dh);
  ctx.globalAlpha = 1;
  // The player pip blinks so it's findable on a busy map.
  const px = dx + Math.round(S.player.x * s), py = dy + Math.round(S.player.y * s);
  if (Math.floor(t / 18) % 2 === 0) R.rect(px - 1, py - 1, 3, 3, '#fff6c4');
  R.rect(px, py, 1, 1, P.ember1);
}

// --- the bar -----------------------------------------------------------------
function drawTop(map) {
  const y = Math.round(2 - hide * 24);
  if (y < -20) return;

  // time + season
  const w1 = 78;
  Frame.panel(4, y, w1, 16, { style: 'hud', alpha: 0.86 });
  skyIcon(8, y + 4, S.clock.hour);
  Frame.write(clockText(), 20, y + 5, 'hud');
  seasonIcon(48, y + 4, S.clock.season);
  Frame.write(`d${S.clock.day}`, 60, y + 5, 'hud');

  // currencies
  const coins = String(S.coins), hearth = String(S.hearth);
  const w2 = 30 + Font.measure(coins) + Font.measure(hearth);
  const x2 = 4 + w1 + 4;
  Frame.panel(x2, y, w2, 16, { style: 'hud', alpha: 0.86 });
  const ci = Atlas.tryGet('ui.coin');
  if (ci) R.blit(ci, x2 + 4, y + 3);
  Frame.write(coins, x2 + 16, y + 5, 'hud');
  const hi = Atlas.tryGet('ui.hearth');
  const hx = x2 + 20 + Font.measure(coins);
  if (hi) R.blit(hi, hx, y + 3);
  Frame.write(hearth, hx + 12, y + 5, 'hud');

  // party health pips
  if (S.party.length) {
    const pw = 8 + S.party.length * 10;
    const x3 = x2 + w2 + 4;
    Frame.panel(x3, y, pw, 16, { style: 'hud', alpha: 0.86 });
    S.party.forEach((g, i) => {
      const f = g.maxhp ? clamp(g.hp / g.maxhp, 0, 1) : 0;
      const px = x3 + 5 + i * 10;
      R.rect(px, y + 4, 6, 8, '#241a12');
      const col = f > 0.5 ? P.hpGood : f > 0.22 ? P.hpWarn : P.hpBad;
      const fh = Math.max(f > 0 ? 1 : 0, Math.round(6 * f));
      R.rect(px + 1, y + 10 - fh, 4, fh, col);
    });
  }
}

// --- toasts ------------------------------------------------------------------
function drawToasts() {
  for (let i = toasts.length - 1; i >= 0; i--) {
    if (--toasts[i].life <= 0) toasts.splice(i, 1);
  }
  toasts.slice(0, 3).forEach((to, i) => {
    const w = Font.measure(to.text) + (to.icon ? 26 : 16);
    const y = 22 + i * 18;
    // Slide in, hold, slide out — driven off remaining life so it never pops.
    const inK = ease.outCubic(clamp((to.total - to.life) / 8, 0, 1));
    const outK = ease.outCubic(clamp(to.life / 8, 0, 1));
    const k = Math.min(inK, outK);
    if (k <= 0.02) return;
    const x = R.W - 6 - w * k;
    Frame.panel(x, y, w * k, 15, { style: 'gold', alpha: k });
    if (k > 0.85) {
      let tx = x + 8;
      if (to.icon) { const im = Atlas.tryGet(to.icon); if (im) { R.blit(im, tx, y + 3); tx += 14; } }
      Frame.write(to.text, tx, y + 4, 'gold');
    }
  });
}

// --- public ------------------------------------------------------------------
export const HUD = {
  toast(text, opts = {}) {
    const life = Math.round((opts.ms || 2000) / 16);
    toasts.push({ text: String(text), icon: opts.icon, life, total: life });
  },

  draw(map) {
    t++;
    // Tuck away while anything is talking, so dialogue owns the screen.
    const want = UIx.busy ? 1 : 0;
    hide += clamp(want - hide, -0.14, 0.14);

    R.layer(LAYER.UI, () => {
      drawTop(map);
      if (hide < 0.5 && map && !map.indoor) {
        const mw = 54, mh = 44;
        drawMinimap(map, R.W - mw - 4, R.H - mh - 4 + Math.round(hide * 60), mw, mh);
      }
      drawToasts();
    });
  },

  invalidateMinimap() { miniFor = null; },
};

export function register() {
  Hooks.install('hud', { draw: map => HUD.draw(map) });
  UIx.install({ toast: (text, opts) => HUD.toast(text, opts), drawToasts: () => {} });
}
