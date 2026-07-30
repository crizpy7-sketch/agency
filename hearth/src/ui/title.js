// The title screen — the first thing anyone sees.
//
// An ember drifting up from a banked hearth, the name set in the game's own font,
// and a save summary on Continue so returning feels like returning somewhere.

import { R, LAYER } from '../core/renderer.js';
import { Input } from '../core/input.js';
import { Scenes } from '../core/scene.js';
import { Atlas } from '../art/atlas.js';
import { Audio } from '../core/audio.js';
import { UIx } from '../core/bridge.js';
import { Font } from '../core/font.js';
import { S, hasSave, load, resetSave, defaults, adopt, save } from '../state.js';
import { P, mix, shade } from '../art/palette.js';
import { clamp, ease, pad2 } from '../core/util.js';
import { makeRng } from '../core/rng.js';
import { START } from '../world/maps.js';

const rng = makeRng(77);

function titleScene() {
  let t = 0, sel = 0, busy = false;
  const embers = [];
  let saved = null;
  let items = [];

  function readSave() {
    if (!hasSave()) { saved = null; return; }
    // Peek without disturbing the live state: load(), read, then keep it — Continue
    // wants exactly this state anyway, and New Journey resets it.
    load();
    saved = {
      name: S.player.name,
      level: S.village?.level || 1,
      party: S.party.length,
      day: S.clock?.day || 1,
      mins: Math.floor((S.playtime || 0) / 3600),
      bonded: S.stats?.bonded || 0,
    };
  }

  function buildItems() {
    items = saved
      ? [{ id: 'continue', label: 'Continue' }, { id: 'new', label: 'New Journey' }, { id: 'settings', label: 'Settings' }]
      : [{ id: 'new', label: 'New Journey' }, { id: 'settings', label: 'Settings' }];
    sel = 0;
  }

  async function choose() {
    const it = items[sel];
    if (!it) return;
    busy = true;
    try {
      Audio.sfx('confirm');
      if (it.id === 'continue') {
        await UIx.fade('out', 16);
        Scenes.reset('overworld');
        await UIx.fade('in', 16);
      } else if (it.id === 'new') {
        if (saved) {
          const ok = await UIx.confirm('Starting a new journey will replace the one you have. Are you sure?');
          if (!ok) return;
        }
        adopt(defaults());
        S.player.map = START.map; S.player.x = START.x; S.player.y = START.y; S.player.dir = START.dir;
        save();
        await UIx.fade('out', 16);
        Scenes.reset('overworld');
        await UIx.fade('in', 16);
        await opening();
      } else {
        await settings();
      }
    } finally { busy = false; }
  }

  async function settings() {
    const i = await UIx.ask('Settings', [
      Audio.muted ? 'Sound: off' : 'Sound: on',
      `Text speed: ${['slow', 'normal', 'fast'][clamp((S.settings.textSpeed || 2) - 1, 0, 2)]}`,
      'Back',
    ]);
    if (i === 0) { S.settings.muted = Audio.toggleMute(); await settings(); }
    else if (i === 1) {
      S.settings.textSpeed = ((S.settings.textSpeed || 2) % 3) + 1;
      await settings();
    }
  }

  async function opening() {
    await UIx.sayMany([
      'Emberhollow was a busy place once. Then it was quiet for a long time.',
      'Gran Willow wrote to you anyway. She said the Hearthstone was still warm, and that warm is all you need to start.',
      'Every journey begins at the hearth.',
    ], { speaker: null });
  }

  function update() {
    t++;
    if (embers.length < 24 && t % 6 === 0) {
      embers.push({ x: 120 + rng.range(-46, 46), y: 150, v: rng.range(0.22, 0.6), p: rng.range(0, 6.28), s: rng.float() < 0.3 ? 2 : 1 });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.y -= e.v; e.p += 0.03;
      if (e.y < -4) embers.splice(i, 1);
    }
    if (busy || UIx.busy) return;
    if (Input.pressed('down')) { sel = (sel + 1) % items.length; Audio.sfx('cursor'); }
    if (Input.pressed('up')) { sel = (sel + items.length - 1) % items.length; Audio.sfx('cursor'); }
    if (Input.pressed('a') || Input.pressed('start')) choose();
  }

  function render() {
    R.layer(LAYER.GROUND, () => {
      // Night sky over a hill, warmed from below by the hearth.
      for (let y = 0; y < R.H; y++) {
        const k = y / R.H;
        R.rect(0, y, R.W, 1, mix('#141b2e', '#3d2b33', ease.inQuad(k)));
      }
      for (let i = 0; i < 40; i++) {
        const sx = (i * 71) % R.W, sy = (i * 37) % 90;
        const tw = 0.4 + 0.6 * Math.sin(t / 30 + i);
        R.rect(sx, sy, 1, 1, `rgba(255,246,214,${0.15 + tw * 0.35})`);
      }
      // Hills
      for (let x = 0; x < R.W; x++) {
        const h1 = 128 + Math.sin(x / 46) * 7 + Math.sin(x / 13) * 2;
        R.rect(x, h1, 1, R.H - h1, '#20321f');
        const h2 = 142 + Math.sin(x / 31 + 2) * 6;
        R.rect(x, h2, 1, R.H - h2, '#16241a');
      }
      // The hearth itself
      const gx = 120, gy = 158;
      R.glow(gx, gy, 46 + Math.sin(t / 22) * 4, 'rgba(255,176,86,0.5)', 0.7);
      for (let i = 0; i < 3; i++) {
        const w = 22 - i * 6;
        R.rect(gx - w / 2, gy - i * 3, w, 3, [P.ember3, P.ember2, P.ember1][i]);
      }
      R.rect(gx - 14, gy + 4, 28, 3, P.rock3);
    });

    R.layer(LAYER.MID, () => {
      for (const e of embers) {
        const x = e.x + Math.sin(e.p) * 5;
        const a = clamp(e.y / 150, 0, 1);
        R.rect(x, e.y, e.s, e.s, `rgba(255,${170 + Math.floor(60 * a)},110,${a})`);
      }
    });

    R.layer(LAYER.UI, () => {
      // Title, with a soft ember glow behind it.
      const cx = R.W / 2;
      const bob = Math.sin(t / 44) * 1;
      R.glow(cx, 44 + bob, 84, 'rgba(245,200,119,0.14)', 0.9);
      R.text('GUARDIANS', cx, 30 + bob, { align: 'center', color: P.gold0, shadow: '#5a3410' });
      R.text('OF THE HEARTH', cx, 44 + bob, { align: 'center', color: P.gold1, shadow: '#5a3410' });
      R.rect(cx - 54, 58 + bob, 108, 1, P.gold3);

      // Menu
      const baseY = 92;
      items.forEach((it, i) => {
        const on = i === sel;
        const y = baseY + i * 16;
        const w = 96;
        if (on) {
          R.rect(cx - w / 2, y - 3, w, 14, 'rgba(245,200,119,0.16)');
          R.stroke(cx - w / 2, y - 3, w, 14, P.gold2);
          const c = Atlas.tryGet('ui.cursor');
          if (c) R.blit(c, cx - w / 2 - 9, y + 1 + Math.sin(t / 8) * 0.6);
        }
        R.text(it.label, cx, y, { align: 'center', color: on ? P.gold0 : P.ui1 });
      });

      // Save summary — returning should feel like returning somewhere.
      if (saved) {
        const y = R.H - 30;
        R.text(`${saved.name} · Emberhollow Lv ${saved.level} · Day ${saved.day}`, cx, y,
          { align: 'center', color: P.ui2 });
        R.text(`${saved.party} in your party · ${saved.bonded} bonded · ${saved.mins} min played`, cx, y + 10,
          { align: 'center', color: P.ui2 });
      } else if (Math.floor(t / 30) % 2 === 0) {
        R.text('press A', cx, R.H - 22, { align: 'center', color: P.ui2 });
      }
    });
  }

  return {
    enter() {
      readSave();
      buildItems();
      t = 0;
      if (Audio.hasSong('title')) Audio.play('title');
    },
    update, render,
  };
}

export function register() {
  Scenes.register('title', () => titleScene());
}
