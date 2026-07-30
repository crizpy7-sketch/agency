// The battle screen: presentation only. The engine decides what happens and hands
// back an ordered event list; this file turns that list into something that feels
// like it landed — timed text, hit flashes, screen shake, draining bars, and a
// bonding sequence that reads as an offer rather than a capture.

import { R, LAYER } from '../core/renderer.js';
import { Input } from '../core/input.js';
import { Scenes } from '../core/scene.js';
import { Atlas } from '../art/atlas.js';
import { Audio } from '../core/audio.js';
import { UIx, Hooks } from '../core/bridge.js';
import { S, addHearth } from '../state.js';
import { Font } from '../core/font.js';
import { P, TYPE_COLOR, mix, shade } from '../art/palette.js';
import { clamp, ease } from '../core/util.js';
import {
  newBattle, chooseAction, stepTurn, activeOf, canRun, canBond,
  forceSwitch, aiAction, hpFrac,
} from './engine.js';
import { makeGuardian, displayName, getSpecies, restEasy } from './species.js';
import { getMove } from './moves.js';
import { CHARMS, bondPreview } from './capture.js';

const MENU = ['Fight', 'Guardians', 'Bag', 'Run'];
const DRAIN = 22;              // frames an HP bar takes to travel its full width
const TEXT_HOLD = 8;

// ---------------------------------------------------------------- battle scene
function battleScene(params) {
  let B = null;
  let phase = 'intro';          // intro | menu | moves | bag | anim | over
  let cursor = 0, moveCursor = 0, bagCursor = 0;
  let queue = [];               // pending engine events
  let text = '', textShown = 0, textHold = 0;
  let t = 0, introT = 0;
  let resolve = null, outcome = null;
  const shownHp = { player: 1, foe: 1 };   // lags real HP so bars drain visibly
  const shownXp = { v: 0 };
  const fx = [];                // {name, x, y, t, frames}
  const flash = { player: 0, foe: 0 };
  const nudge = { player: 0, foe: 0 };
  let bonding = null;           // {t, beats, ok}
  let evolving = null;

  // --- layout ---
  const FOE = { x: 196, y: 26 };
  const PLR = { x: 52, y: 74 };

  function setText(s, hold = TEXT_HOLD) {
    text = s; textShown = 0; textHold = hold;
  }

  function begin() {
    const party = S.party.length ? S.party : demoParty();
    const foe = params?.foeGuardian
      || makeGuardian(params?.speciesId || 'leafowl', params?.level || 5, { where: params?.where || 'the tall grass' });
    B = newBattle({
      party, foe, kind: params?.kind || 'wild',
      seed: (Date.now() ^ (S.seed || 1)) >>> 0,
      ctx: {
        villageLevel: safeLevel(), streak: S.missions?.streak || 0,
        charm: 'charm', playerName: S.player.name,
      },
    });
    shownHp.player = hpFrac(activeOf(B, 'player'));
    shownHp.foe = hpFrac(activeOf(B, 'foe'));
    shownXp.v = xpFrac(activeOf(B, 'player'));
    S.seen[B.foeParty[0].species] = S.seen[B.foeParty[0].species] || 'seen';
    setText(`A wild ${displayName(activeOf(B, 'foe'))} steps out of the grass!`, 26);
  }

  // --- event consumption -----------------------------------------------------
  function pump() {
    if (textHold > 0) { textHold--; return; }
    if (!queue.length) {
      if (B.over) { finish(); return; }
      if (B.needSwitch) { openForcedSwitch(); return; }
      phase = 'menu';
      return;
    }
    const e = queue.shift();
    applyEvent(e);
  }

  function applyEvent(e) {
    switch (e.k) {
      case 'text':
        setText(e.s, e.hold ?? TEXT_HOLD);
        if (e.punch) { R.shake(3, 8); Audio.sfx('confirm'); }
        break;

      case 'damage': {
        const side = e.target;
        if (e.missed) { Audio.sfx('cancel'); break; }
        if (!e.heal) {
          flash[side] = 10;
          nudge[side] = 8;
          const power = e.eff >= 2 ? 5 : e.eff < 1 ? 1 : 3;
          R.shake(power, 10);
          Audio.sfx('bump', { rate: e.eff >= 2 ? 0.8 : 1.2, gain: 1.2 });
        } else Audio.sfx('chime');
        const at = side === 'foe' ? FOE : PLR;
        spawnFx(e.anim?.fx || 'fx.impact', at.x + 32, at.y + 32);
        textHold = Math.max(textHold, 12);
        break;
      }

      case 'status': Audio.sfx('deny'); textHold = 8; break;
      case 'stat': {
        const at = e.target === 'foe' ? FOE : PLR;
        spawnFx(e.anim?.fx || 'fx.sparkle', at.x + 32, at.y + 40);
        Audio.sfx('cursor'); textHold = 8; break;
      }

      case 'faint': {
        Audio.sfx('deny');
        textHold = 24;
        break;
      }

      case 'switch': shownHp.player = hpFrac(activeOf(B, 'player')); textHold = 10; break;

      case 'xp': shownXp.v = shownXp.v; textHold = 10; break;
      case 'levelup': {
        Audio.sfx('chime');
        spawnFx('fx.star', PLR.x + 32, PLR.y + 10);
        textHold = 20;
        break;
      }
      case 'evolve': evolving = { t: 0, from: e.from, to: e.to, name: e.name }; textHold = 90; break;

      case 'bond-try': bonding = { t: 0, beats: e.beats ?? 3, ok: false }; Audio.sfx('coin'); textHold = 70; break;
      case 'bond-ok':
        bonding = bonding || { t: 0, beats: 3 };
        bonding.ok = true;
        Audio.sfx('chime');
        spawnFx('fx.heart', FOE.x + 32, FOE.y + 24);
        if (e.hearth) addHearth(e.hearth);
        S.seen[e.species] = 'bonded';
        textHold = 30;
        break;
      case 'bond-fail': bonding = null; Audio.sfx('cancel'); textHold = 20; break;

      case 'end': outcome = e.outcome; textHold = 20; break;
      default: textHold = 6;
    }
  }

  function spawnFx(name, x, y) {
    const frames = Atlas.has(name) ? Atlas.frames(name) : 0;
    if (!frames) return;
    fx.push({ name, x, y, t: 0, frames });
  }

  // --- player actions --------------------------------------------------------
  function submit(action) {
    chooseAction(B, 'player', action);
    chooseAction(B, 'foe', aiAction(B, 'foe'));
    queue = stepTurn(B).slice();
    phase = 'anim';
    textHold = 0;
  }

  async function openForcedSwitch() {
    phase = 'anim';
    const live = B.party.map((g, i) => ({ g, i })).filter(o => o.g.hp > 0);
    if (!live.length) { finish(); return; }
    let pick = live[0].i;
    try {
      const chosen = await Hooks.party.chooseGuardian({ reason: 'faint', party: B.party });
      if (typeof chosen === 'number' && chosen >= 0 && B.party[chosen]?.hp > 0) pick = chosen;
    } catch {}
    queue = forceSwitch(B, pick).slice();
    shownHp.player = hpFrac(activeOf(B, 'player'));
  }

  async function finish() {
    if (phase === 'over') return;
    phase = 'over';
    for (const g of B.party) restEasy(g);
    const result = outcome || B.outcome || 'fled';
    await UIx.fade('out', 14);
    Scenes.pop(result);
    resolve?.(result);
  }

  // --- update ----------------------------------------------------------------
  function update() {
    t++;
    if (textShown < text.length) textShown += 2;
    for (let i = fx.length - 1; i >= 0; i--) if (++fx[i].t > fx[i].frames * 4) fx.splice(i, 1);
    for (const k of ['player', 'foe']) { if (flash[k] > 0) flash[k]--; if (nudge[k] > 0) nudge[k]--; }
    if (bonding) bonding.t++;
    if (evolving) evolving.t++;

    // Bars chase their true value so damage reads as a drain, not a jump.
    const pf = hpFrac(activeOf(B, 'player')), ff = hpFrac(activeOf(B, 'foe'));
    shownHp.player += clamp(pf - shownHp.player, -1 / DRAIN, 1 / DRAIN);
    shownHp.foe += clamp(ff - shownHp.foe, -1 / DRAIN, 1 / DRAIN);
    const xf = xpFrac(activeOf(B, 'player'));
    shownXp.v += clamp(xf - shownXp.v, -1 / 40, 1 / 40);

    if (phase === 'intro') {
      introT++;
      // Long enough for the slide-in to land, short enough not to make anyone wait.
      if (introT > 26 && (Input.pressed('a') || introT > 54)) { phase = 'anim'; queue = []; textHold = 0; }
      return;
    }

    if (phase === 'anim') {
      // Holding A fast-forwards the beat, which is what impatient players want.
      if (Input.held('a') && textHold > 2) textHold -= 2;
      if (textShown < text.length && Input.held('a')) textShown += 3;
      pump();
      return;
    }

    if (phase === 'menu') {
      const n = MENU.length;
      if (Input.pressed('down') || Input.pressed('right')) { cursor = (cursor + 1) % n; Audio.sfx('cursor'); }
      if (Input.pressed('up') || Input.pressed('left')) { cursor = (cursor + n - 1) % n; Audio.sfx('cursor'); }
      if (Input.pressed('a')) {
        Audio.sfx('confirm');
        const pick = MENU[cursor];
        if (pick === 'Fight') { phase = 'moves'; moveCursor = 0; }
        else if (pick === 'Guardians') openParty();
        else if (pick === 'Bag') { phase = 'bag'; bagCursor = 0; }
        else if (pick === 'Run') {
          if (!canRun(B)) { setText('There is no running from this one.', 20); phase = 'anim'; }
          else submit({ type: 'run' });
        }
      }
      return;
    }

    if (phase === 'moves') {
      const g = activeOf(B, 'player');
      const n = Math.max(1, g.moves.length);
      if (Input.pressed('down')) { moveCursor = (moveCursor + 2) % n; Audio.sfx('cursor'); }
      if (Input.pressed('up')) { moveCursor = (moveCursor + n - 2) % n; Audio.sfx('cursor'); }
      if (Input.pressed('right')) { moveCursor = (moveCursor + 1) % n; Audio.sfx('cursor'); }
      if (Input.pressed('left')) { moveCursor = (moveCursor + n - 1) % n; Audio.sfx('cursor'); }
      if (Input.pressed('b')) { phase = 'menu'; Audio.sfx('cancel'); }
      if (Input.pressed('a')) {
        const m = g.moves[moveCursor];
        if (!m || m.focus <= 0) { Audio.sfx('deny'); setText('That move has no focus left.', 16); phase = 'anim'; return; }
        Audio.sfx('confirm');
        submit({ type: 'move', id: m.id });
      }
      return;
    }

    if (phase === 'bag') {
      const items = bagItems();
      if (Input.pressed('down')) { bagCursor = (bagCursor + 1) % items.length; Audio.sfx('cursor'); }
      if (Input.pressed('up')) { bagCursor = (bagCursor + items.length - 1) % items.length; Audio.sfx('cursor'); }
      if (Input.pressed('b')) { phase = 'menu'; Audio.sfx('cancel'); }
      if (Input.pressed('a')) {
        const it = items[bagCursor];
        if (!it || it.n <= 0) { Audio.sfx('deny'); return; }
        Audio.sfx('confirm');
        if (it.bond) {
          if (!canBond(B)) { setText('You cannot offer a charm to a friend’s Guardian.', 20); phase = 'anim'; return; }
          submit({ type: 'bond', charm: it.id });
        } else submit({ type: 'item', id: it.id });
      }
    }
  }

  async function openParty() {
    phase = 'anim'; textHold = 2;
    try {
      const i = await Hooks.party.chooseGuardian({ reason: 'switch', party: B.party });
      if (typeof i === 'number' && i >= 0 && i !== B.active && B.party[i]?.hp > 0) {
        submit({ type: 'switch', i });
        return;
      }
    } catch {}
    phase = 'menu';
  }

  // --- render ----------------------------------------------------------------
  function render() {
    R.layer(LAYER.GROUND, () => drawBackdrop());
    R.layer(LAYER.ENTITY, () => {
      drawBattler('foe');
      drawBattler('player');
      drawFx();
    });
    R.layer(LAYER.UI, () => {
      drawPanel('foe');
      drawPanel('player');
      drawTextbox();
      if (phase === 'menu') drawMenu();
      else if (phase === 'moves') drawMoves();
      else if (phase === 'bag') drawBag();
      if (evolving) drawEvolve();
    });
  }

  function drawBackdrop() {
    // An outdoor arena that echoes the overworld rather than a flat colour field.
    const sky = mix(P.water0, P.paper0, 0.45);
    R.rect(0, 0, R.W, 96, sky);
    for (let i = 0; i < 3; i++) {
      const y = 44 + i * 8;
      R.rect(0, y, R.W, 8, mix(P.leaf3, sky, 0.72 - i * 0.18));
    }
    R.rect(0, 96, R.W, R.H - 96, P.grass2);
    R.rect(0, 92, R.W, 6, P.grass1);
    for (let x = 0; x < R.W; x += 4) {
      R.rect(x, 96 + ((x / 4) % 2), 2, 1, P.grass0);
      R.rect(x + 2, 118 + ((x / 4) % 3), 2, 1, P.grass3);
    }
    // Ground discs the battlers stand on — they anchor the sprites.
    disc(FOE.x + 32, FOE.y + 60, 42, 12, P.grass1);
    disc(PLR.x + 32, PLR.y + 62, 52, 14, P.grass1);
  }

  function disc(cx, cy, rx, ry, c) {
    for (let y = -ry; y <= ry; y++) {
      const half = Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)) * rx;
      R.rect(cx - half, cy + y, half * 2, 1, y < 0 ? mix(c, '#ffffff', 0.12) : c);
    }
  }

  function drawBattler(side) {
    const g = activeOf(B, side);
    if (!g) return;
    const at = side === 'foe' ? FOE : PLR;
    const bob = Math.sin(t / 26 + (side === 'foe' ? 1 : 0)) * 1.5;
    const slide = phase === 'intro'
      ? (1 - ease.outCubic(Math.min(1, introT / 34))) * (side === 'foe' ? 90 : -90)
      : 0;
    const push = nudge[side] > 0 ? Math.sin(nudge[side] / 8 * Math.PI) * (side === 'foe' ? 4 : -4) : 0;
    const name = `g.${g.species}.${side === 'foe' ? 'front' : 'back'}`;
    const img = Atlas.tryGet(name);
    const x = at.x + slide + push, y = at.y + bob;
    const fainted = g.hp <= 0;
    const sink = fainted ? 16 : 0;

    const sh = Atlas.tryGet('fx.shadow.big');
    if (sh) R.blit(sh, x, at.y + 54, { alpha: fainted ? 0.15 : 0.42 });

    if (!img) { R.rect(x + 8, y + 8, 48, 48, '#ff00ff'); return; }
    if (bonding && side === 'foe') {
      const k = Math.min(1, bonding.t / 30);
      if (bonding.ok && bonding.t > 40) return;
      R.blit(img, x, y + sink, { alpha: 1 - k * 0.75 });
      return;
    }
    if (evolving && side === 'player') return;   // the evolution overlay owns the sprite
    if (flash[side] > 0 && flash[side] % 4 < 2) R.silhouette(img, x, y, '#ffffff', 0.9);
    else R.blit(img, x, y + sink, { alpha: fainted ? 0.4 : 1 });
  }

  function drawFx() {
    for (const f of fx) {
      const img = Atlas.tryGet(f.name, Math.floor(f.t / 4));
      if (img) R.blit(img, f.x - img.width / 2, f.y - img.height / 2);
    }
    if (bonding) {
      const k = Math.min(1, bonding.t / 26);
      const cx = PLR.x + 40 + (FOE.x - PLR.x) * ease.outQuad(k);
      const cy = PLR.y + 20 - Math.sin(k * Math.PI) * 40 + (FOE.y - PLR.y) * k;
      const img = Atlas.tryGet('fx.charm', Math.floor(bonding.t / 4));
      if (img) R.blit(img, cx - img.width / 2, cy - img.height / 2);
      if (bonding.t > 30) {
        const beat = Math.floor((bonding.t - 30) / 14);
        for (let i = 0; i < Math.min(beat, bonding.beats); i++) {
          const h = Atlas.tryGet('ui.heart');
          if (h) R.blit(h, FOE.x + 18 + i * 12, FOE.y + 66);
        }
      }
    }
  }

  function drawPanel(side) {
    const g = activeOf(B, side);
    if (!g) return;
    const foe = side === 'foe';
    const w = foe ? 112 : 124;
    const h = foe ? 30 : 40;
    const x = foe ? 8 : R.W - w - 8;
    const y = foe ? 10 : 92;
    UIx.panel(x, y, w, h, 'paper');

    R.text(displayName(g), x + 7, y + 5, { color: P.ink2, shadow: false });
    R.text(`${g.lvl}`, x + w - 8, y + 5, { color: P.ink2, shadow: false, align: 'right' });
    R.text('Lv', x + w - 19, y + 5, { color: P.ui2, shadow: false, align: 'right' });

    // Type badges carry their name — an unlabelled colour block tells the player nothing.
    g.types.forEach((ty, i) => {
      const bx = x + 7 + i * 25, by = y + 16;
      const b = Atlas.tryGet(`ui.type.${ty}`);
      if (b) R.blit(b, bx, by);
      else R.rect(bx, by, 22, 9, TYPE_COLOR[ty] || P.ui2);
      R.text(ty.slice(0, 3).toUpperCase(), bx + 11, by + 1,
        { color: '#fffaf0', shadow: shade(TYPE_COLOR[ty] || P.ui2, -0.55), align: 'center' });
    });

    const barX = x + 7 + g.types.length * 25 + 3;
    hpBar(barX, y + 18, x + w - 8 - barX, shownHp[side]);
    if (!foe) {
      R.text(`${Math.max(0, Math.ceil(shownHp.player * g.maxhp))}/${g.maxhp}`,
        x + w - 8, y + 26, { color: P.ink2, shadow: false, align: 'right' });
      R.text('XP', x + 8, y + 32, { color: P.ui2, shadow: false });
      xpBar(x + 22, y + 34, w - 30, shownXp.v);
    }
  }

  function hpBar(x, y, w, frac) {
    const f = clamp(frac, 0, 1);
    R.rect(x - 1, y - 1, w + 2, 6, P.ui4);
    R.rect(x, y, w, 4, '#2c2418');
    const col = f > 0.5 ? P.hpGood : f > 0.22 ? P.hpWarn : P.hpBad;
    R.rect(x, y, Math.round(w * f), 4, col);
    R.rect(x, y, Math.round(w * f), 1, mix(col, '#ffffff', 0.45));
  }

  function xpBar(x, y, w, frac) {
    R.rect(x - 1, y - 1, w + 2, 4, P.ui4);
    R.rect(x, y, w, 2, '#1d2a34');
    R.rect(x, y, Math.round(w * clamp(frac, 0, 1)), 2, P.xp);
  }

  function drawTextbox() {
    const h = 44;
    UIx.panel(6, R.H - h - 4, R.W - 12, h, 'paper');
    const lines = Font.wrap(text, R.W - 34);
    let n = textShown;
    lines.slice(0, 3).forEach((l, i) => {
      const limit = Math.max(0, Math.min(l.length, n));
      n -= l.length;
      R.text(l, 16, R.H - h + 4 + i * 12, { color: P.ink2, shadow: false, limit });
    });
  }

  function drawMenu() {
    const w = 128, h = 44, x = R.W - w - 6, y = R.H - h - 4;
    UIx.panel(x, y, w, h, 'paper');
    MENU.forEach((m, i) => {
      const mx = x + 14 + (i % 2) * 58, my = y + 8 + Math.floor(i / 2) * 16;
      const on = i === cursor;
      if (on) {
        R.rect(mx - 4, my - 2, 54, 13, mix(P.gold1, P.paper0, 0.55));
        const c = Atlas.tryGet('ui.cursor');
        if (c) R.blit(c, mx - 11, my + Math.sin(t / 8) * 0.5);
        else R.text('▶', mx - 11, my, { color: P.gold3, shadow: false });
      }
      R.text(m, mx, my, { color: on ? P.ink : P.ink3, shadow: false });
    });
  }

  function drawMoves() {
    const g = activeOf(B, 'player');
    const w = R.W - 12, h = 50, x = 6, y = R.H - h - 4;
    UIx.panel(x, y, w, h, 'paper');
    const m0 = g.moves[moveCursor];
    g.moves.forEach((m, i) => {
      const mx = x + 16 + (i % 2) * 132, my = y + 8 + Math.floor(i / 2) * 15;
      const on = i === moveCursor;
      if (on) {
        R.rect(mx - 5, my - 2, 126, 13, mix(P.gold1, P.paper0, 0.5));
        const c = Atlas.tryGet('ui.cursor');
        if (c) R.blit(c, mx - 12, my);
      }
      const dim = m.focus <= 0;
      R.text(m.name, mx, my, { color: dim ? P.ui2 : on ? P.ink : P.ink3, shadow: false });
      R.text(`${m.focus}/${m.maxFocus ?? m.focus}`, mx + 120, my, { color: P.ui2, shadow: false, align: 'right' });
    });
    if (m0) {
      const b = Atlas.tryGet(`ui.type.${m0.type}`);
      if (b) R.blit(b, x + 16, y + h - 13);
      R.text(`POW ${m0.power || '—'}   ACC ${m0.acc ? Math.round(m0.acc * 100) : '—'}`,
        x + 46, y + h - 12, { color: P.ink3, shadow: false });
    }
  }

  function drawBag() {
    const items = bagItems();
    const w = 150, h = 52, x = R.W - w - 6, y = R.H - h - 4;
    UIx.panel(x, y, w, h, 'paper');
    items.slice(0, 3).forEach((it, i) => {
      const my = y + 8 + i * 14;
      const on = i === bagCursor;
      if (on) {
        R.rect(x + 8, my - 2, w - 16, 13, mix(P.gold1, P.paper0, 0.5));
        const c = Atlas.tryGet('ui.cursor');
        if (c) R.blit(c, x + 3, my);
      }
      R.text(it.name, x + 14, my, { color: it.n > 0 ? P.ink2 : P.ui2, shadow: false });
      R.text(`x${it.n}`, x + w - 12, my, { color: P.ink3, shadow: false, align: 'right' });
    });
    if (canBond(B)) {
      const pv = safeBondPreview();
      if (pv) R.text(`bond chance ~${Math.round(pv * 100)}%`, x + 14, y + h - 12, { color: P.ui2, shadow: false });
    }
  }

  function drawEvolve() {
    const k = Math.min(1, evolving.t / 90);
    R.rect(0, 0, R.W, R.H, `rgba(12,10,18,${0.55 * k})`);
    const from = Atlas.tryGet(`g.${evolving.from}.front`);
    const to = Atlas.tryGet(`g.${evolving.to}.front`);
    const cx = R.W / 2 - 32, cy = 40;
    const flicker = evolving.t % 8 < 4;
    const img = k < 0.75 ? (flicker ? from : to) : to;
    if (img) {
      if (k < 0.85) R.silhouette(img, cx, cy, '#ffffff', 0.95);
      else R.blit(img, cx, cy);
    }
    const g = Atlas.tryGet('fx.evolve', Math.floor(evolving.t / 6) % 6);
    if (g) R.blit(g, cx + 20, cy + 20);
  }

  // --- helpers ---------------------------------------------------------------
  function bagItems() {
    return [
      { id: 'charm', name: 'Woven Charm', n: S.bag.charm || 0, bond: true },
      { id: 'salve', name: 'Warm Salve', n: S.bag.salve || 0 },
      { id: 'kindling', name: 'Kindling', n: S.bag.kindling || 0 },
    ];
  }
  function safeBondPreview() {
    try {
      return bondPreview(activeOf(B, 'foe'), {
        charm: 'charm', villageLevel: safeLevel(), streak: S.missions?.streak || 0,
      })?.p ?? null;
    } catch { return null; }
  }

  return {
    enter(p) {
      params = p || params || {};
      resolve = params.__resolve || null;
      begin();
      phase = 'intro'; introT = 0;
      if (Audio.hasSong('battle')) Audio.play('battle');
    },
    exit() { if (Audio.hasSong('field')) Audio.play('field'); },
    update, render,
  };
}

const xpFrac = g => {
  if (!g || !g.xpNext) return 0;
  return clamp(g.xp / g.xpNext, 0, 1);
};

const safeLevel = () => { try { return Hooks.village.level(); } catch { return 1; } };

// A party for `?scene=battle` so the screen is always inspectable, and for a brand
// new save that somehow reaches a battle before Gran hands one over.
function demoParty() {
  return [makeGuardian('embercub', 6, { where: 'the hearth' })];
}

// ---------------------------------------------------------------- registration
export function register() {
  Scenes.register('battle', () => battleScene(null));

  Hooks.install('battle', {
    canBattle() { return true; },
    async start(params) {
      const res = await Scenes.pushAsync('battle', params || {});
      return res || 'fled';
    },
  });
}
